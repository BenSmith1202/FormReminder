import { useEffect, useState, useMemo } from 'react';
import { 
  Paper, Typography, Box, CircularProgress, Chip, Stack, Button, 
  IconButton, Grid, Card, CardContent, LinearProgress, 
  Tooltip, Container
} from '@mui/material';
import { 
  DataGrid, type GridColDef, type GridRenderCellParams 
} from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';

// Icons
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import AssessmentIcon from '@mui/icons-material/Assessment';
import AssignmentIcon from '@mui/icons-material/Assignment';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

import API_URL from '../config';

// --- Interfaces ---
interface HealthResponse {
  status: string;
  database: string;
  submission_count?: number; 
}

interface FormRequestRow {
  id: string;
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
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<FormRequestRow[]>([]); 
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // --- Statistics Calculation ---
  const stats = useMemo(() => {
    const activeForms = rows.filter(r => r.status === 'Active').length;
    const totalResponses = rows.reduce((acc, curr) => acc + (curr.response_count || 0), 0);
    const totalRecipients = rows.reduce((acc, curr) => acc + (curr.total_recipients || 0), 0);
    // Avoid division by zero
    const overallRate = totalRecipients > 0 ? Math.round((totalResponses / totalRecipients) * 100) : 0;
    
    return { activeForms, totalResponses, overallRate };
  }, [rows]);

  // --- Column Definitions ---
  const columns: GridColDef[] = [
    { 
      field: 'title', 
      headerName: 'Form Name', 
      flex: 1.5, 
      minWidth: 200,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {params.value}
          </Typography>
          {params.row.warnings && params.row.warnings.length > 0 && (
             <Typography variant="caption" color="error.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
               <ErrorOutlineIcon fontSize="inherit" /> Attention needed
             </Typography>
          )}
        </Box>
      )
    },
    { 
      field: 'progress', 
      headerName: 'Completion', 
      flex: 1,
      minWidth: 180,
      renderCell: (params: GridRenderCellParams) => {
        const responded = params.row.response_count || 0;
        const total = params.row.total_recipients || 0;
        const percentage = total > 0 ? Math.min(100, (responded / total) * 100) : 0;
        
        return (
          <Box sx={{ width: '100%', mr: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                {responded} / {total}
              </Typography>
              <Typography variant="caption" fontWeight="bold">
                {Math.round(percentage)}%
              </Typography>
            </Box>
            <LinearProgress 
              variant="determinate" 
              value={percentage} 
              color={percentage === 100 ? "success" : "primary"}
              sx={{ 
                height: 6, 
                borderRadius: 3,
                bgcolor: 'action.hover'
              }} 
            />
          </Box>
        );
      }
    },
    { 
      field: 'status', 
      headerName: 'Status', 
      width: 120,
      renderCell: (params: GridRenderCellParams) => {
        const isActive = params.value === 'Active';
        return (
          <Chip 
            label={params.value} 
            size="small" 
            sx={{ 
              fontWeight: 600,
              bgcolor: isActive ? 'success.light' : 'grey.200',
              color: isActive ? 'success.dark' : 'text.secondary',
              border: 'none'
            }} 
          />
        );
      }
    },
    { 
      field: 'last_synced_at', 
      headerName: 'Last Synced', 
      width: 140,
      valueFormatter: (params: any) => {
        if (!params) return 'Never';
        try {
          return new Date(params).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch { return 'Never'; }
      }
    },
    { 
      field: 'actions', 
      headerName: 'Actions', 
      width: 160,
      sortable: false,
      align: 'right',
      headerAlign: 'right',
      renderCell: (params: GridRenderCellParams) => (
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="View Details">
            <IconButton 
              size="small" 
              onClick={(e) => { e.stopPropagation(); navigate(`/request/${params.row.id}`); }}
              sx={{ color: 'primary.main', bgcolor: 'primary.50', '&:hover': { bgcolor: 'primary.100' } }}
            >
              <VisibilityIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Duplicate">
            <IconButton 
              size="small" 
              onClick={(e) => { e.stopPropagation(); handleDuplicate(params.row.id); }}
              sx={{ color: 'grey.600', '&:hover': { bgcolor: 'grey.100' } }}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton 
              size="small" 
              onClick={(e) => { e.stopPropagation(); handleDelete(params.row.id); }}
              sx={{ color: 'error.main', '&:hover': { bgcolor: 'error.50' } }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      )
    },
  ];

  // --- Data Fetching ---

  // Duplicate a form request and navigate to the new one
  const handleDuplicate = async (requestId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/form-requests/${requestId}/duplicate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to duplicate');
      
      const result = await response.json();
      // Navigate to the new duplicated form request
      navigate(`/request/${result.form_request.id}`);
    } catch (error: any) {
      alert(`Failed to duplicate: ${error.message}`);
    }
  };

  const handleDelete = async (requestId: string) => {
    if (!window.confirm('Delete this form request? This action cannot be undone.')) return;

    try {
      const response = await fetch(`${API_URL}/api/form-requests/${requestId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to delete');
      loadFormRequests(); // Reload
    } catch (error: any) {
      alert(`Failed to delete: ${error.message}`);
    }
  };

  const loadFormRequests = async () => {
    try {
      const response = await fetch(`${API_URL}/api/form-requests`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to load');
      
      const formRequests = await response.json();
      
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
      console.error('Error loading data:', error);
    }
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await refreshAllFormRequests();
    setRefreshing(false);
  };

  const refreshAllFormRequests = async () => {
    try {
      const response = await fetch(`${API_URL}/api/form-requests`, { credentials: 'include' });
      if (!response.ok) return;
      const formRequests = await response.json();
      
      const refreshPromises = formRequests.map((req: any) =>
        fetch(`${API_URL}/api/form-requests/${req.id}/refresh`, {
          method: 'POST',
          credentials: 'include',
        }).catch(() => null)
      );
      
      await Promise.all(refreshPromises);
      await loadFormRequests();
      
      // Also refresh health status
      fetch(`${API_URL}/api/health`, { credentials: 'include' })
        .then(res => res.json())
        .then(healthData => setData(healthData))
        .catch(() => {});

    } catch (error) {
      console.error('Refresh error:', error);
    }
  };

  // --- Effects ---

  // Initial Load
  useEffect(() => {
    const initLoad = async () => {
      // Load health check first
      fetch(`${API_URL}/api/health`, { credentials: 'include' })
        .then(res => res.ok ? res.json() : { status: "error" })
        .then(setData)
        .catch(() => setData({ status: "error", database: "disconnected" }));

      await loadFormRequests();
      setLoading(false);
    };

    initLoad();
  }, []);

  // Auto-refresh interval
  useEffect(() => {
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') refreshAllFormRequests();
    }, 30000);
    return () => clearInterval(pollInterval);
  }, []);

  // --- Render ---

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <CircularProgress size={40} thickness={4} />
      </Box>
    );
  }

  // Helper component for stats cards
  const StatCard = ({ title, value, subtext, icon, color }: any) => (
    <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', height: '100%' }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography color="text.secondary" variant="subtitle2" gutterBottom fontWeight="bold">
              {title}
            </Typography>
            <Typography variant="h4" fontWeight="bold" sx={{ mb: 0.5 }}>
              {value}
            </Typography>
            {subtext && (
              <Typography variant="body2" color="text.secondary">
                {subtext}
              </Typography>
            )}
          </Box>
          <Box 
            sx={{ 
              p: 1.5, 
              borderRadius: 2, 
              bgcolor: `${color}.50`, 
              color: `${color}.main`,
              display: 'flex' 
            }}
          >
            {icon}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header Section */}
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'start', sm: 'center' }} spacing={2} sx={{ mb: 4 }}>
        <Box>
          <Typography variant="h4" fontWeight="bold" gutterBottom>
            Dashboard
          </Typography>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="body2" color="text.secondary">
              Overview of your forms and responses
            </Typography>
            {lastUpdated && (
              <Tooltip title={`Last full sync: ${lastUpdated.toLocaleTimeString()}`}>
                <Chip 
                  label="Up to date" 
                  size="small" 
                  color="success" 
                  variant="outlined" 
                  icon={<CheckCircleIcon />}
                  sx={{ height: 20, fontSize: '0.7rem' }}
                />
              </Tooltip>
            )}
          </Stack>
        </Box>
        
        <Stack direction="row" spacing={2}>
           <Button 
            variant="outlined" 
            startIcon={<RefreshIcon sx={{ animation: refreshing ? 'spin 1s linear infinite' : 'none', '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } } }} />}
            onClick={handleManualRefresh}
            disabled={refreshing}
          >
            {refreshing ? 'Syncing...' : 'Sync Now'}
          </Button>
          <Button 
            variant="contained" 
            startIcon={<AddIcon />} 
            onClick={() => navigate('/requests/new')}
            sx={{ px: 3 }}
          >
            New Request
          </Button>
        </Stack>
      </Stack>

      {/* Metrics Grid */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard 
            title="Active Forms" 
            value={stats.activeForms} 
            subtext={`Total forms: ${rows.length}`}
            icon={<AssignmentIcon />} 
            color="primary"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard 
            title="Total Responses" 
            value={stats.totalResponses} 
            subtext="Across all active forms"
            icon={<AssessmentIcon />} 
            color="info"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard 
            title="Response Rate" 
            value={`${stats.overallRate}%`} 
            subtext="Average completion"
            icon={<CheckCircleIcon />} 
            color="success"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard 
            title="System Status" 
            value={data?.status === 'healthy' ? 'Healthy' : 'Issues'} 
            subtext={data?.database === 'connected' ? 'Database connected' : 'Database Error'}
            icon={<RefreshIcon />} 
            color={data?.status === 'healthy' ? 'success' : 'warning'}
          />
        </Grid>
      </Grid>

      {/* Main Data Table */}
      <Paper 
        elevation={0} 
        sx={{ 
          border: '1px solid', 
          borderColor: 'divider',
          overflow: 'hidden',
          borderRadius: 2
        }}
      >
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Typography variant="h6" fontWeight="bold">
            Recent Requests
          </Typography>
        </Box>
        
        <Box sx={{ height: 500, width: '100%' }}>
          <DataGrid
            rows={rows}
            columns={columns}
            onRowClick={(params) => navigate(`/request/${params.row.id}`)}
            slots={{ 
              noRowsOverlay: () => (
                <Stack height="100%" alignItems="center" justifyContent="center" spacing={2}>
                  <AssignmentIcon sx={{ fontSize: 60, color: 'text.disabled' }} />
                  <Typography color="text.secondary">No form requests found</Typography>
                  <Button variant="text" onClick={() => navigate('/requests/new')}>Create one now</Button>
                </Stack>
              ) 
            }}
            initialState={{
              pagination: { paginationModel: { pageSize: 10 } },
              sorting: { sortModel: [{ field: 'created_at', sort: 'desc' }] }, // Default sort by newest
            }}
            pageSizeOptions={[5, 10, 25]}
            disableRowSelectionOnClick
            sx={{
              border: 'none',
              cursor: 'pointer',
              '& .MuiDataGrid-columnHeaders': {
                bgcolor: 'grey.50',
                color: 'text.secondary',
                fontWeight: 'bold',
              },
              '& .MuiDataGrid-cell:focus': {
                outline: 'none',
              },
            }}
          />
        </Box>
      </Paper>
    </Container>
  );
}