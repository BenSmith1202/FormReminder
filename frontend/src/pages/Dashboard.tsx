import { useEffect, useState } from 'react';
import { Paper, Typography, Box, CircularProgress, Chip, Stack, Button, Link, Alert, IconButton } from '@mui/material';
import { DataGrid, type GridColDef, type GridRenderCellParams } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import DeleteIcon from '@mui/icons-material/Delete';

const API_URL = 'http://localhost:5000';

// Interface for the health data
interface HealthResponse {
  status: string;
  database: string;
  submission_count?: number; 
}

// Interface for the table rows
interface FormRequestRow {
  id: string; // Firestore document ID
  title: string;
  response_count: number;
  total_recipients: number;
  created_at: string;
  last_synced_at: string;
  status: 'Active' | 'Inactive';
  warnings?: string[];
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FormRequestRow[]>([]); 
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState(0);

  // Column Definitions
  const columns: GridColDef[] = [
    { 
      field: 'title', 
      headerName: 'Form Name', 
      flex: 1.5, 
      minWidth: 200 
    },
    { 
      field: 'response_count', 
      headerName: 'Responses', 
      width: 120, 
      align: 'center', 
      headerAlign: 'center',
      renderCell: (params: GridRenderCellParams) => {
        const responded = params.row.response_count || 0;
        const total = params.row.total_recipients || 0;
        return (
          <Typography variant="body2">
            {responded} / {total}
          </Typography>
        );
      }
    },
    { 
      field: 'created_at', 
      headerName: 'Created', 
      width: 120,
      valueFormatter: (params: any) => {
        if (!params) return '-';
        try {
          const date = new Date(params);
          return date.toLocaleDateString();
        } catch {
          return '-';
        }
      }
    },
    { 
      field: 'last_synced_at', 
      headerName: 'Last Synced', 
      width: 120,
      valueFormatter: (params: any) => {
        if (!params) return '-';
        try {
          const date = new Date(params);
          return date.toLocaleDateString();
        } catch {
          return '-';
        }
      }
    },
    { 
      field: 'status', 
      headerName: 'Status', 
      width: 100,
      renderCell: (params: GridRenderCellParams) => {
        if (!params || !params.value) return <Typography variant="caption">-</Typography>;
        return (
          <Chip 
            label={params.value} 
            color={params.value === 'Active' ? 'success' : 'default'} 
            size="small" 
            variant="outlined" 
          />
        );
      }
    },
    { 
      field: 'actions', 
      headerName: '', 
      width: 150,
      sortable: false,
      renderCell: (params: GridRenderCellParams) => {
        if (!params) return null;
        return (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button 
              variant="outlined" 
              size="small" 
              onClick={() => navigate(`/request/${params.row.id}`)}
            >
              View
            </Button>
            <IconButton 
              size="small" 
              onClick={() => handleDelete(params.row.id)}
              title="Delete form request"
              color="error"
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        );
      }
    },
  ];

  const handleDelete = async (requestId: string) => {
    if (!window.confirm('Are you sure you want to delete this form request? This will also delete all associated responses.')) {
      return;
    }

    try {
      console.log(`Deleting form request: ${requestId}`);
      const response = await fetch(`${API_URL}/api/form-requests/${requestId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete');
      }
      
      console.log('✅ Delete successful:', result);
      // Reload the form requests
      loadFormRequests();
    } catch (error: any) {
      console.error('❌ Delete failed:', error);
      alert(`Failed to delete: ${error.message}`);
    }
  };

  const loadFormRequests = async () => {
    try {
      const response = await fetch(`${API_URL}/api/form-requests`, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const formRequests = await response.json();
      
      console.log('Loaded form requests:', formRequests);
      
      // Transform to table rows
      const transformedRows: FormRequestRow[] = Array.isArray(formRequests) 
        ? formRequests.map((request: any) => ({
            id: request.id,
            title: request.title || 'Untitled Form',
            response_count: request.response_count || 0,
            total_recipients: request.total_recipients || 0,
            created_at: request.created_at,
            last_synced_at: request.last_synced_at,
            status: request.is_active ? 'Active' : 'Inactive',
            warnings: request.warnings || []
          }))
        : [];
      
      setRows(transformedRows);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to load form requests:', error);
      console.error('Auto-refresh error:', error);
      setRows([]);
    }
  };

  // Custom Message when table is empty
  const CustomNoRowsOverlay = () => (
    <Stack height="100%" alignItems="center" justifyContent="center">
      <Typography color="text.secondary">
        You don't have any form requests.{' '}
        <Link 
            component="button" 
            variant="body1" 
            onClick={() => navigate('/new')}
            sx={{ verticalAlign: 'baseline', fontWeight: 'bold' }}
        >
            Click here
        </Link>
        {' '}to make one!
      </Typography>
    </Stack>
  );

  // Auto-refresh polling
  useEffect(() => {
    // Poll every 30 seconds
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        // Refresh all form requests from Google Forms
        refreshAllFormRequests();
      }
    }, 30000);

    // Handle tab visibility changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Immediately refresh when tab becomes active
        refreshAllFormRequests();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const refreshAllFormRequests = async () => {
    try {
      // Get all form requests
      const response = await fetch(`${API_URL}/api/form-requests`, {
        credentials: 'include',
      });
      
      if (!response.ok) return;
      
      const formRequests = await response.json();
      
      // Refresh each form request from Google Forms (in parallel)
      const refreshPromises = formRequests.map((req: any) =>
        fetch(`${API_URL}/api/form-requests/${req.id}/refresh`, {
          method: 'POST',
          credentials: 'include',
        }).catch(err => {
          console.error(`Auto-refresh error for ${req.id}:`, err);
          return null; // Continue with other refreshes even if one fails
        })
      );
      
      await Promise.all(refreshPromises);
      
      // Now load the updated data
      await loadFormRequests();
    } catch (error) {
      console.error('Auto-refresh error:', error);
      // Still try to load cached data
      loadFormRequests();
    }
  };

  // Update "seconds since update" counter
  useEffect(() => {
    if (!lastUpdated) return;

    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
      setSecondsSinceUpdate(seconds);
    }, 1000);

    return () => clearInterval(timer);
  }, [lastUpdated]);

  useEffect(() => {
    // Fetch health check and form requests in parallel
    Promise.all([
      fetch(`${API_URL}/api/health`, { credentials: 'include' })
        .then((res) => {
          if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
          }
          return res.json();
        })
        .catch((err) => {
          console.error("Failed to fetch health check", err);
          return {
            status: "error",
            database: "disconnected"
          };
        }),
      fetch(`${API_URL}/api/form-requests`, { credentials: 'include' })
        .then((res) => {
          if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
          }
          return res.json();
        })
        .catch((err) => {
          console.error("Failed to fetch form requests", err);
          return [];
        })
    ]).then(([healthData, formRequests]) => {
      try {
        setData(healthData);
        
        const transformedRows: FormRequestRow[] = Array.isArray(formRequests) 
          ? formRequests.map((request: any) => ({
              id: request.id,
              title: request.title || 'Untitled Form',
              response_count: request.response_count || 0,
              total_recipients: request.total_recipients || 0,
              created_at: request.created_at,
              last_synced_at: request.last_synced_at,
              status: request.is_active ? 'Active' : 'Inactive',
              warnings: request.warnings || []
            }))
          : [];
        
        setRows(transformedRows);
        setLoading(false);
      } catch (error) {
        console.error("Error processing data:", error);
        setRows([]);
        setLoading(false);
      }
    }).catch((error) => {
      console.error("Error fetching data:", error);
      setData({
        status: "error",
        database: "disconnected"
      });
      setRows([]);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 5 }}>
        <CircularProgress />
      </Box>
    );
  }

  // Safety check - ensure data exists
  if (!data) {
    return (
      <Box>
        <Typography variant="h4" gutterBottom>
          Your Form Requests
        </Typography>
        <Alert severity="warning">
          Unable to load dashboard data. Please check your connection.
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Box>
          <Typography variant="h4">
            Your Form Requests
          </Typography>
          {lastUpdated && (
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
              Last updated: {secondsSinceUpdate}s ago
            </Typography>
          )}
        </Box>
        <Button
          variant="contained"
          onClick={() => navigate('/new')}
        >
          Create New
        </Button>
      </Box>

      {/* Metric Cards */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ mb: 4 }}>
        <Box sx={{ flex: 1 }}>
          <Paper sx={{ p: 3, display: 'flex', flexDirection: 'column', height: 140 }}>
            <Typography component="h2" variant="h6" color="primary" gutterBottom>
              System Status
            </Typography>
            <Box>
               Status: <Chip label={data?.status || "Unknown"} color="success" size="small" />
            </Box>
            <Box sx={{ mt: 1 }}>
               Database: <Chip label={data?.database || "Unknown"} color="primary" size="small" />
            </Box>
          </Paper>
        </Box>

        <Box sx={{ flex: 1 }}>
          <Paper sx={{ p: 3, display: 'flex', flexDirection: 'column', height: 140 }}>
            <Typography component="h2" variant="h6" color="primary" gutterBottom>
              Live Submissions
            </Typography>
            <Typography component="p" variant="h3">
              {data?.submission_count || 0}
            </Typography>
            <Typography color="text.secondary" sx={{ flex: 1 }}>
              responses recorded today
            </Typography>
          </Paper>
        </Box>
      </Stack>

        {/* Call to Action */}
            <Button variant="contained" color="primary" sx={{ mb: 1, mt: 1}} onClick={() => navigate('/new')}>
                New Request
            </Button>
        {/* Data Grid Table */}
        <Paper sx={{ height: 400, width: '100%', p: 1 }}>
            <DataGrid
                rows={Array.isArray(rows) ? rows : []}
                columns={columns}
                slots={{ noRowsOverlay: CustomNoRowsOverlay }}
                initialState={{
                    pagination: { paginationModel: { pageSize: 10 } },
                }}
                pageSizeOptions={[5, 10, 25]}
                disableRowSelectionOnClick
            />
        </Paper>
    </Box>
);
}