import { useEffect, useState } from 'react';
import { Paper, Typography, Box, CircularProgress, Chip, Stack, Button, Link, Alert } from '@mui/material';
import { DataGrid, type GridColDef, type GridRenderCellParams } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';

// Interface for the health data
interface HealthResponse {
  status: string;
  database: string;
  submission_count?: number; 
}

// Interface for the table rows (matching your requirements)
interface FormRequestRow {
  id: number; // DataGrid requires a unique 'id'
  name: string;
  responded: number | null;
  recipients: number | null;
  issued: string | null;
  last_reminder: string | null;
  status: 'Active' | 'Inactive' | null;
  next_reminder: string | null;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FormRequestRow[]>([]); 

  // Column Definitions
  const columns: GridColDef[] = [
    { field: 'name', headerName: 'Name', flex: 1.5, minWidth: 200 },
    { 
      field: 'responded', 
      headerName: 'Responded', 
      width: 100, 
      align: 'center', 
      headerAlign: 'center',
      valueFormatter: (params: any) => params?.value ?? '-'
    },
    { 
      field: 'recipients', 
      headerName: 'Recipients', 
      width: 100, 
      align: 'center', 
      headerAlign: 'center',
      valueFormatter: (params: any) => params?.value ?? '-'
    },
    { 
      field: 'issued', 
      headerName: 'Issued', 
      width: 120, 
      valueFormatter: (params: any) => params?.value ?? '-'
    },
    { 
      field: 'last_reminder', 
      headerName: 'Last Reminder', 
      width: 120, 
      valueFormatter: (params: any) => params?.value ?? '-'
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
      field: 'next_reminder', 
      headerName: 'Next Reminder', 
      width: 120, 
      valueFormatter: (params: any) => params?.value ?? '-'
    },
    { 
      field: 'details', 
      headerName: '', 
      width: 100,
      sortable: false,
      renderCell: (params: GridRenderCellParams) => {
        if (!params) return null;
        return (
          <Button variant="outlined" size="small" onClick={() => console.log('View details', params.id)}>
            Details
          </Button>
        );
      }
    },
  ];

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

  useEffect(() => {
    // Fetch health check and form requests in parallel
    Promise.all([
      fetch('http://127.0.0.1:5000/api/health')
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
      fetch('http://127.0.0.1:5000/api/form-requests')
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
        
        // Transform form requests to table rows - handle empty or invalid data
        const transformedRows: FormRequestRow[] = Array.isArray(formRequests) 
          ? formRequests.map((request: any, index: number) => {
              let issuedDate = null;
              if (request?.created_at) {
                try {
                  const date = new Date(request.created_at);
                  if (!isNaN(date.getTime())) {
                    issuedDate = date.toLocaleDateString();
                  }
                } catch (e) {
                  console.warn("Invalid date format:", request.created_at);
                }
              }
              
              return {
                id: index + 1, // DataGrid needs numeric ID
                name: request?.name || `Form ${request?.form_id?.substring(0, 8) || 'Unknown'}`,
                responded: request?.responded ?? null,
                recipients: request?.recipients ?? null,
                issued: issuedDate,
                last_reminder: request?.last_reminder ?? null,
                status: (request?.status as 'Active' | 'Inactive') || null,
                next_reminder: request?.next_reminder ?? null,
                _documentId: request?.id // Store the actual Firestore document ID
              };
            })
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
      <Typography variant="h4" gutterBottom>
        Your Form Requests
      </Typography>

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