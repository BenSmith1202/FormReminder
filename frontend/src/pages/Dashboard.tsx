import { useEffect, useState, useMemo } from 'react';
import { useLoaderData, useNavigate } from 'react-router-dom';
import {
  Paper, Typography, Box, Chip, Button, IconButton, Card, CardContent,
  LinearProgress, Tooltip, Container, Stack, Avatar
} from '@mui/material';
import { DataGrid, type GridColDef, type GridRenderCellParams } from '@mui/x-data-grid';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import AssessmentIcon from '@mui/icons-material/Assessment';
import AssignmentIcon from '@mui/icons-material/Assignment';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import StorageIcon from '@mui/icons-material/Storage';

import API_URL from '../config';

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

// ── Stat Card ──────────────────────────────────────────────────────────────
function StatCard({
  title,
  value,
  subtext,
  icon,
  iconBg,
  iconColor,
}: {
  title: string;
  value: string | number;
  subtext?: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <Card
      elevation={0}
      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, height: '100%' }}
    >
      <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
        <Box display="flex" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight="bold" display="block" gutterBottom>
              {title.toUpperCase()}
            </Typography>
            <Typography variant="h4" component="p" fontWeight="bold" lineHeight={1}>
              {value}
            </Typography>
            {subtext && (
              <Typography variant="body2" color="text.secondary" mt={0.75}>
                {subtext}
              </Typography>
            )}
          </Box>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2,
              bgcolor: iconBg,
              color: iconColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

// ── Mobile Request Card ────────────────────────────────────────────────────
function RequestCard({
  row,
  onView,
  onDuplicate,
  onDelete,
}: {
  row: FormRequestRow;
  onView: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const pct =
    row.total_recipients > 0
      ? Math.min(100, Math.round((row.response_count / row.total_recipients) * 100))
      : 0;
  const isActive = row.status === 'Active';


  
  return (
    <Paper
      elevation={0}
      onClick={onView}
      sx={{
        p: 2.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 3,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        '&:hover': { borderColor: 'primary.main', boxShadow: 2 },
      }}
    >
      <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={1} mb={1.5}>
        <Box display="flex" alignItems="center" gap={1.5} minWidth={0}>
          <Avatar
            sx={{
              width: 36,
              height: 36,
              bgcolor: isActive ? 'primary.50' : 'grey.100',
              color: isActive ? 'primary.main' : 'text.disabled',
              flexShrink: 0,
              fontSize: '0.85rem',
              fontWeight: 'bold',
            }}
          >
            {row.title[0]?.toUpperCase()}
          </Avatar>
          <Box minWidth={0}>
            <Typography variant="subtitle2" fontWeight="bold" noWrap>
              {row.title}
            </Typography>
            {row.warnings && row.warnings.length > 0 && (
              <Typography variant="caption" color="error.main" display="flex" alignItems="center" gap={0.5}>
                <ErrorOutlineIcon sx={{ fontSize: 12 }} /> Attention needed
              </Typography>
            )}
          </Box>
        </Box>
        <Chip
          label={row.status}
          size="small"
          sx={{
            fontWeight: 600,
            flexShrink: 0,
            bgcolor: isActive ? 'success.50' : 'grey.200',
            color: isActive ? 'success.dark' : 'text.primary',
          }}
        />
      </Box>

      <Box mb={1.5}>
        <Box display="flex" justifyContent="space-between" mb={0.5}>
          <Typography variant="caption" color="text.secondary">
            {row.response_count} / {row.total_recipients} responses
          </Typography>
          <Typography variant="caption" fontWeight="bold">
            {pct}%
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={pct}
          color={pct === 100 ? 'success' : 'primary'}
          sx={{ height: 5, borderRadius: 3, bgcolor: 'action.hover' }}
        />
      </Box>

      <Box display="flex" alignItems="center" justifyContent="space-between">
        <Typography variant="caption" color="text.disabled">
          Synced{' '}
          {row.last_synced_at
            ? new Date(row.last_synced_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })
            : 'Never'}
        </Typography>
        <Box display="flex" gap={0.5} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="View Details">
            <IconButton size="small" onClick={onView} sx={{ color: 'primary.main' }}>
              <VisibilityIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Duplicate">
            <IconButton size="small" onClick={onDuplicate} sx={{ color: 'grey.500' }}>
              <ContentCopyIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton size="small" onClick={onDelete} sx={{ color: 'error.main' }}>
              <DeleteIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </Paper>
  );
}

export async function dashboardLoader() {
  try {
    const [healthRes, requestsRes] = await Promise.all([
      fetch(`${API_URL}/api/health`, { credentials: 'include' }),
      fetch(`${API_URL}/api/form-requests`, { credentials: 'include' })
    ]);

    const healthData = healthRes.ok ? await healthRes.json() : { status: 'error', database: 'disconnected' };
    const rawRequests = requestsRes.ok ? await requestsRes.json() : [];
    
    const transformedRows = Array.isArray(rawRequests) ? rawRequests.map((req: any) => ({
      id: req.id,
      title: req.title || 'Untitled Form',
      response_count: req.response_count || 0,
      total_recipients: req.total_recipients || 0,
      created_at: req.created_at,
      last_synced_at: req.last_synced_at,
      status: req.is_active ? 'Active' : 'Inactive',
      warnings: req.warnings || [],
    })) : [];

    return { initialHealth: healthData, initialRows: transformedRows };
  } catch (error) {
    return { initialHealth: { status: 'error', database: 'disconnected' }, initialRows: [] };
  }
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate();
  const { initialHealth, initialRows } = useLoaderData() as any;

  // Initialize state with loader data
  const [data, setData] = useState<HealthResponse | null>(initialHealth);
  const [rows, setRows] = useState<FormRequestRow[]>(initialRows);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(new Date());

  const stats = useMemo(() => {
    const activeForms = rows.filter((r) => r.status === 'Active').length;
    const totalResponses = rows.reduce((acc, curr) => acc + (curr.response_count || 0), 0);
    const totalRecipients = rows.reduce((acc, curr) => acc + (curr.total_recipients || 0), 0);
    const overallRate = totalRecipients > 0 ? Math.round((totalResponses / totalRecipients) * 100) : 0;
    return { activeForms, totalResponses, overallRate };
  }, [rows]);

  // ── DataGrid column defs ──
  const columns: GridColDef[] = [
    {
      field: 'title',
      headerName: 'Form Name',
      flex: 1.5,
      minWidth: 200,
      renderCell: (params) => (
        <Box display="flex" flexDirection="column" justifyContent="center">
          <Typography variant="subtitle2" fontWeight={600}>
            {params.value}
          </Typography>
          {params.row.warnings && params.row.warnings.length > 0 && (
            <Typography
              variant="caption"
              color="error.main"
              display="flex"
              alignItems="center"
              gap={0.5}
            >
              <ErrorOutlineIcon fontSize="inherit" /> Attention needed
            </Typography>
          )}
        </Box>
      ),
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
            <Box display="flex" justifyContent="space-between" mb={0.5}>
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
              color={percentage === 100 ? 'success' : 'primary'}
              sx={{ height: 6, borderRadius: 3, bgcolor: 'action.hover' }}
            />
          </Box>
        );
      },
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
              bgcolor: isActive ? 'success.50' : 'grey.200',
              color: isActive ? 'success.dark' : 'text.primary',
            }}
          />
        );
      },
    },
    {
      field: 'last_synced_at',
      headerName: 'Last Synced',
      width: 140,
      valueFormatter: (params: any) => {
        if (!params) return 'Never';
        try {
          return new Date(params).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
        } catch {
          return 'Never';
        }
      },
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 140,
      sortable: false,
      align: 'right',
      headerAlign: 'right',
      renderCell: (params: GridRenderCellParams) => (
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="View Details">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/request/${params.row.id}`);
              }}
              sx={{ color: 'primary.main', bgcolor: 'primary.50', '&:hover': { bgcolor: 'primary.100' } }}
            >
              <VisibilityIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Duplicate">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleDuplicate(params.row.id);
              }}
              sx={{ color: 'grey.600', '&:hover': { bgcolor: 'grey.100' } }}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(params.row.id);
              }}
              sx={{ color: 'error.main', '&:hover': { bgcolor: 'error.50' } }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  const handleDuplicate = async (requestId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/form-requests/${requestId}/duplicate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to duplicate');
      const result = await response.json();
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
      loadFormRequests(); // Re-fetch data after deleting
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
            warnings: request.warnings || [],
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
      await Promise.all(
        formRequests.map((req: any) =>
          fetch(`${API_URL}/api/form-requests/${req.id}/refresh`, {
            method: 'POST',
            credentials: 'include',
          }).catch(() => null)
        )
      );
      await loadFormRequests();
      fetch(`${API_URL}/api/health`, { credentials: 'include' })
        .then((res) => res.json())
        .then((healthData) => setData(healthData))
        .catch(() => {});
    } catch (error) {
      console.error('Refresh error:', error);
    }
  };

  // Polling useEffect remains
  useEffect(() => {
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') refreshAllFormRequests();
    }, 30000);
    return () => clearInterval(pollInterval);
  }, []);

  const isHealthy = data?.status === 'healthy';
  const isDbConnected = data?.database === 'connected';

  return (
    <Container maxWidth="xl" sx={{ py: 4 }} className="page-fade-in">
      {/* ── Page Header ── */}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        flexDirection={{ xs: 'column', sm: 'row' }}
        gap={2}
        mb={4}
      >
        <Box>
          <Typography variant="h4" component="h1" fontWeight="bold" gutterBottom>
            Dashboard
          </Typography>
          <Box display="flex" alignItems="center" gap={1}>
            <Typography variant="body2" color="text.secondary">
              Overview of your forms and responses
            </Typography>
            {lastUpdated && (
              <Tooltip title={`Last synced: ${lastUpdated.toLocaleTimeString()}`}>
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
          </Box>
        </Box>

        <Box display="flex" gap={1.5}>
          <Button
            variant="outlined"
            startIcon={
              <RefreshIcon
                sx={{
                  animation: refreshing ? 'spin 1s linear infinite' : 'none',
                  '@keyframes spin': {
                    '0%': { transform: 'rotate(0deg)' },
                    '100%': { transform: 'rotate(360deg)' },
                  },
                }}
              />
            }
            onClick={handleManualRefresh}
            disabled={refreshing}
          >
            {refreshing ? 'Syncing…' : 'Sync Now'}
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/requests/new')}
          >
            New Request
          </Button>
        </Box>
      </Box>

      {/* ── Stat Cards ── */}
      <Box
        display="grid"
        gridTemplateColumns={{ xs: '1fr 1fr', md: 'repeat(4, 1fr)' }}
        gap={2.5}
        mb={4}
      >
        <StatCard
          title="Active Forms"
          value={stats.activeForms}
          subtext={`${rows.length} total`}
          icon={<AssignmentIcon fontSize="small" />}
          iconBg="primary.50"
          iconColor="primary.main"
        />
        <StatCard
          title="Total Responses"
          value={stats.totalResponses}
          subtext="Across all forms"
          icon={<AssessmentIcon fontSize="small" />}
          iconBg="info.50"
          iconColor="info.main"
        />
        <StatCard
          title="Response Rate"
          value={`${stats.overallRate}%`}
          subtext="Average completion"
          icon={<CheckCircleIcon fontSize="small" />}
          iconBg="success.50"
          iconColor="success.main"
        />
        <StatCard
          title="System Status"
          value={isHealthy ? 'Healthy' : 'Issues'}
          subtext={isDbConnected ? 'Database connected' : 'Database error'}
          icon={<StorageIcon fontSize="small" />}
          iconBg={isHealthy ? 'success.50' : 'warning.50'}
          iconColor={isHealthy ? 'success.main' : 'warning.main'}
        />
      </Box>

      {/* ── Requests Table / Cards ── */}
      <Paper
        elevation={0}
        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden' }}
      >
        {/* Panel header */}
        <Box
          px={3}
          py={2}
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}
        >
          <Typography variant="subtitle1" fontWeight="bold">
            Form Requests
          </Typography>
          <Chip label={`${rows.length} total`} size="small" variant="outlined" />
        </Box>

        {/* Mobile card list */}
        <Box sx={{ display: { xs: 'block', md: 'none' }, p: 2 }}>
          {rows.length === 0 ? (
            <Box py={6} textAlign="center">
              <AssignmentIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1.5 }} />
              <Typography color="text.secondary" gutterBottom>
                No form requests yet
              </Typography>
              <Button variant="text" onClick={() => navigate('/requests/new')}>
                Create one now
              </Button>
            </Box>
          ) : (
            <Stack spacing={1.5}>
              {rows.map((row) => (
                <RequestCard
                  key={row.id}
                  row={row}
                  onView={() => navigate(`/request/${row.id}`)}
                  onDuplicate={() => handleDuplicate(row.id)}
                  onDelete={() => handleDelete(row.id)}
                />
              ))}
            </Stack>
          )}
        </Box>

        {/* Desktop DataGrid */}
        <Box sx={{ display: { xs: 'none', md: 'block' }, height: 500 }}>
          <DataGrid
            aria-label="Form requests"
            disableVirtualization
            rows={rows}
            columns={columns}
            onRowClick={(params) => navigate(`/request/${params.row.id}`)}
            slots={{
              noRowsOverlay: () => (
                <Stack height="100%" alignItems="center" justifyContent="center" spacing={2}>
                  <AssignmentIcon sx={{ fontSize: 60, color: 'text.disabled' }} />
                  <Typography color="text.secondary">No form requests found</Typography>
                  <Button variant="text" onClick={() => navigate('/requests/new')}>
                    Create one now
                  </Button>
                </Stack>
              ),
            }}
            initialState={{
              pagination: { paginationModel: { pageSize: 10 } },
              sorting: { sortModel: [{ field: 'created_at', sort: 'desc' }] },
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
              '& .MuiDataGrid-cell:focus': { outline: 'none' },
              '& .MuiDataGrid-row:hover': { bgcolor: 'primary.50' },
            }}
          />
        </Box>
      </Paper>
    </Container>
  );
}