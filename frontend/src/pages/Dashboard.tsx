/**
 * Dashboard.tsx
 *
 * The main landing page of the application after login.
 *
 * Responsibilities:
 *  - Fetches and displays all form requests belonging to the logged-in user
 *  - Shows aggregate stats (active forms, total responses, response rate, system health)
 *  - Provides a DataGrid (desktop) and card list (mobile) view of form requests
 *  - Supports duplicating and deleting requests
 *  - Polls the backend every 30 seconds to keep data fresh while the tab is visible
 *
 * Data flow:
 *  - dashboardLoader() runs before the component mounts (React Router loader)
 *  - The component receives pre-fetched data via useLoaderData()
 *  - Subsequent refreshes update local state without a full page reload
 */

import { useEffect, useState, useMemo, useRef } from 'react';
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
import { TextField, InputAdornment } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';

import API_URL from '../config';
import AnimatedInfoButton from '../components/InfoButton';

// ── Types ──────────────────────────────────────────────────────────────────

/** Shape of the response from GET /api/health */
interface HealthResponse {
  status: string;       // e.g. 'healthy' | 'error'
  database: string;     // e.g. 'connected' | 'disconnected'
  submission_count?: number;
}

/** A single row in the form-requests table / card list */
interface FormRequestRow {
  id: string;
  title: string;
  provider?: string;           // 'google' | 'jotform' | 'microsoft'
  response_count: number;      // How many recipients have responded
  total_recipients: number;    // Total number of recipients for this form
  created_at: string;          // ISO date string
  last_synced_at: string;      // ISO date string of last Google Forms sync
  status: 'Active' | 'Inactive';
  warnings?: string[];         // Optional backend-generated warning messages
}

/** Aggregate stats derived from the rows array, computed via useMemo */
interface DashboardStats {
  activeForms: number;    // Count of rows with status === 'Active'
  totalResponses: number; // Sum of response_count across all rows
  overallRate: number;    // (totalResponses / totalRecipients) * 100, rounded
}

// ── Sub-components ─────────────────────────────────────────────────────────

/**
 * StatCard
 *
 * A single summary metric card displayed in the top stats grid.
 * Shows a title, a large numeric/text value, optional subtext, and a
 * colour-coded icon avatar in the top-right corner.
 */
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
  iconBg: string;      // MUI sx color token for the icon background, e.g. 'primary.50'
  iconColor: string;   // MUI sx color token for the icon itself, e.g. 'primary.main'
}) {
  return (
    <Card
      elevation={0}
      sx={{ 
        borderRadius: 3,
        border: '1px solid',
        borderColor: 'divider', 
        height: '100%',
        // Faint blue-to-white background gradient
        background: 'linear-gradient(135deg, #f4f9ff 0%, #ffffff 100%)',
        // Smooth transition for the hover lift effect
        transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
        boxShadow: '0 4px 10px -4px rgba(0,0,0,0.1)',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: '0 12px 24px -10px rgba(0,0,0,0.2)',
        }
      }}
    >
      <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
        <Box display="flex" justifyContent="space-between" alignItems="flex-start">
          {/* Left: title, value, optional subtext */}
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
          {/* Right: colour-coded icon avatar */}
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

/**
 * RequestCard
 *
 * Mobile-only card representation of a single FormRequestRow.
 * Shown in a stacked list on xs/sm screens in place of the DataGrid.
 *
 * Includes:
 *  - Title avatar + name + optional warning badge
 *  - Active/Inactive status chip
 *  - Response progress bar
 *  - Last-synced date
 *  - View / Duplicate / Delete action buttons
 *
 * Note: the action buttons call e.stopPropagation() so clicks don't
 * bubble up to the card's own onClick (which navigates to the detail page).
 */
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
  // Completion percentage, capped at 100 to guard against data anomalies
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
        background: 'linear-gradient(135deg, #ffffff 0%, #f7fbff 100%)',
        transition: 'all 0.2s ease-in-out',
        '&:hover': { 
          transform: 'translateY(-2px) scale(1.01)',
          borderColor: 'primary.main', 
          boxShadow: '0 8px 20px -8px rgba(0,0,0,0.15)' 
        },
      }}
    >
      {/* ── Header row: avatar + title + status chip ── */}
      <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={1} mb={1.5}>
        <Box display="flex" alignItems="center" gap={1.5} minWidth={0}>
          {/* First letter of the title as an avatar, styled by active state */}
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
            {/* Show an "Attention needed" caption if the backend flagged warnings */}
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

      {/* ── Progress bar: responses / total recipients ── */}
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

      {/* ── Footer row: last-synced date + action buttons ── */}
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
        {/* Stop propagation so these don't trigger the card's onView handler */}
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

// ── Loader ─────────────────────────────────────────────────────────────────

/**
 * dashboardLoader
 *
 * React Router loader function — runs on the server before the Dashboard
 * component mounts, so the page renders with data immediately (no loading
 * spinner on first paint).
 *
 * Fetches in parallel:
 *  1. GET /api/health   — system / database status
 *  2. GET /api/form-requests — all form requests for the current user
 *
 * Transforms raw API request objects into the FormRequestRow shape expected
 * by the DataGrid and card list.
 *
 * On any fetch failure, returns safe empty defaults so the page still renders.
 */
export async function dashboardLoader() {
  try {
    // Fire both requests simultaneously to reduce total load time
    const [healthRes, requestsRes] = await Promise.all([
      fetch(`${API_URL}/api/health`, { credentials: 'include' }),
      fetch(`${API_URL}/api/form-requests`, { credentials: 'include' })
    ]);

    const healthData: HealthResponse = healthRes.ok
      ? await healthRes.json()
      : { status: 'error', database: 'disconnected' };

    const rawRequests = requestsRes.ok ? await requestsRes.json() : [];

    // Normalise raw API objects into the typed FormRequestRow shape
    const transformedRows: FormRequestRow[] = Array.isArray(rawRequests)
      ? rawRequests.map((req: any) => ({
          id: req.id,
          title: req.title || 'Untitled Form',
          response_count: req.response_count || 0,
          total_recipients: req.total_recipients || 0,
          created_at: req.created_at,
          last_synced_at: req.last_synced_at,
          status: req.is_active ? 'Active' : 'Inactive',
          warnings: req.warnings || [],
        }))
      : [];

    return { initialHealth: healthData, initialRows: transformedRows };
  } catch (error) {
    // Return safe defaults — the page will show an empty state rather than crashing
    return { initialHealth: { status: 'error', database: 'disconnected' }, initialRows: [] };
  }
}

// ── Main Component ─────────────────────────────────────────────────────────

/**
 * Dashboard
 *
 * Top-level page component. Rendered at the '/' route inside Layout.
 *
 * State:
 *  - data          Health API response used for the System Status stat card
 *  - rows          All form request rows (kept in sync with the backend)
 *  - searchQuery   Mobile search field value, used to filter card list
 *  - refreshing    True while a manual "Sync Now" refresh is in flight
 *  - lastUpdated   Timestamp of the last successful data refresh
 *
 * Derived (useMemo):
 *  - stats             Aggregate counts computed from `rows`
 *  - filteredMobileRows  `rows` filtered by `searchQuery` for the mobile list
 *
 * Side effects:
 *  - useEffect polls refreshAllFormRequests every 30 s while the tab is visible
 */
export default function Dashboard() {
  const navigate = useNavigate();

  // Pre-fetched data injected by dashboardLoader()
  const { initialHealth, initialRows } = useLoaderData() as {
    initialHealth: HealthResponse;
    initialRows: FormRequestRow[];
  };

  // ── State ────────────────────────────────────────────────────────────────

  const [data, setData] = useState<HealthResponse | null>(initialHealth);
  const [rows, setRows] = useState<FormRequestRow[]>(initialRows);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(new Date());

  // Guard to prevent overlapping background refresh cycles
  const refreshInProgress = useRef<boolean>(false);
  // Track last refresh time per request to throttle slower providers
  const lastRefreshTime = useRef<Record<string, number>>({});

  // ── Redirect to onboarding if no providers connected ─────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/connected-accounts`, { credentials: 'include' });
        if (!res.ok) return;
        const accts = await res.json();
        // Only redirect if the user is logged in but has zero providers
        if (accts.authenticated && !accts.google && !accts.jotform && !accts.microsoft) {
          navigate('/connect-forms', { replace: true });
        }
      } catch {
        // ignore — dashboard still renders normally
      }
    })();
  }, [navigate]);

  // ── Derived state ─────────────────────────────────────────────────────────

  /**
   * Aggregate statistics shown in the four stat cards at the top of the page.
   * Re-computed only when `rows` changes.
   */
  const stats: DashboardStats = useMemo(() => {
    const activeForms = rows.filter((r) => r.status === 'Active').length;
    const totalResponses = rows.reduce((acc, curr) => acc + (curr.response_count || 0), 0);
    const totalRecipients = rows.reduce((acc, curr) => acc + (curr.total_recipients || 0), 0);
    const overallRate = totalRecipients > 0
      ? Math.round((totalResponses / totalRecipients) * 100)
      : 0;
    return { activeForms, totalResponses, overallRate };
  }, [rows]);

  /**
   * Rows filtered by the mobile search field.
   * Searches across form title and status (case-insensitive).
   * Returns the full rows array when the search query is empty.
   */
  const filteredMobileRows: FormRequestRow[] = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const lowerQuery = searchQuery.toLowerCase();
    return rows.filter(
      (row) =>
        row.title.toLowerCase().includes(lowerQuery) ||
        row.status.toLowerCase().includes(lowerQuery)
    );
  }, [rows, searchQuery]);

  // ── DataGrid column definitions ───────────────────────────────────────────

  /**
   * Column definitions for the MUI DataGrid rendered on desktop (md+).
   * Each column maps a FormRequestRow field to a header, width, and optional
   * custom render function.
   */
  const columns: GridColDef[] = [
    // Form name with optional warning badge beneath it
    {
      field: 'title',
      headerName: 'Form Name',
      flex: 1.5,
      minWidth: 200,
      renderCell: (params: GridRenderCellParams) => (
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
    // Inline progress bar showing responses vs. total recipients
    {
      field: 'progress',
      headerName: 'Completion',
      flex: 1,
      minWidth: 180,
      renderCell: (params: GridRenderCellParams) => {
        const responded: number = params.row.response_count || 0;
        const total: number = params.row.total_recipients || 0;
        const percentage: number = total > 0 ? Math.min(100, (responded / total) * 100) : 0;
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
    // Colour-coded Active / Inactive chip
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      renderCell: (params: GridRenderCellParams) => {
        const isActive: boolean = params.value === 'Active';
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
    // Human-readable date/time of the last Google Forms sync
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
    // View / Duplicate / Delete action buttons — stopPropagation prevents row navigation
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

  // ── API handlers ──────────────────────────────────────────────────────────

  /**
   * handleDuplicate
   *
   * Sends a POST to /api/form-requests/:id/duplicate, then navigates to the
   * newly created duplicate's detail page.
   */
  const handleDuplicate = async (requestId: string): Promise<void> => {
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

  /**
   * handleDelete
   *
   * Prompts the user for confirmation, then sends DELETE to
   * /api/form-requests/:id. Reloads the request list on success.
   */
  const handleDelete = async (requestId: string): Promise<void> => {
    if (!window.confirm('Delete this form request? This action cannot be undone.')) return;
    try {
      const response = await fetch(`${API_URL}/api/form-requests/${requestId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to delete');
      // Re-fetch the list to reflect the deletion in the UI
      loadFormRequests();
    } catch (error: any) {
      alert(`Failed to delete: ${error.message}`);
    }
  };

  /**
   * loadFormRequests
   *
   * Fetches the current list of form requests from the backend and updates
   * the `rows` state. Also updates `lastUpdated` to the current time.
   * Called after a delete, and by refreshAllFormRequests after syncing.
   */
  const loadFormRequests = async (): Promise<void> => {
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

  /**
   * handleManualRefresh
   *
   * Called when the user clicks the "Sync Now" button.
   * Sets `refreshing` to true (triggers spinner animation) for the duration
   * of the full sync cycle.
   */
  const handleManualRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await refreshAllFormRequests(true);
    setRefreshing(false);
  };

  /**
   * refreshAllFormRequests
   *
   * Full sync cycle:
   *  1. Fetches the current list of form request IDs
   *  2. Fires POST /api/form-requests/:id/refresh for eligible requests
   *     (respects provider-specific intervals: Google 30s, Jotform 2min, Microsoft 5min)
   *  3. Reloads the local list via loadFormRequests()
   *  4. Refreshes the health status chip in the header
   *
   * @param force - If true, ignore provider throttles (used by manual "Sync Now")
   */
  const refreshAllFormRequests = async (force = false): Promise<void> => {
    // Prevent overlapping refresh cycles (e.g. a slow Microsoft refresh
    // could overlap with the next 30-second poll).
    if (refreshInProgress.current) return;
    refreshInProgress.current = true;
    try {
      const response = await fetch(`${API_URL}/api/form-requests`, { credentials: 'include' });
      if (!response.ok) return;
      const formRequests = await response.json();

      const now = Date.now();
      // Provider-specific minimum intervals (ms)
      const PROVIDER_INTERVALS: Record<string, number> = {
        google: 30_000,     // 30 seconds
        jotform: 120_000,   // 2 minutes
        microsoft: 300_000, // 5 minutes
      };

      // Filter to requests that are due for a refresh
      const eligible = formRequests.filter((req: any) => {
        if (force) return true;
        const provider = req.provider || 'google';
        const minInterval = PROVIDER_INTERVALS[provider] ?? 30_000;
        const lastTime = lastRefreshTime.current[req.id] || 0;
        return now - lastTime >= minInterval;
      });

      // Trigger a backend sync for every eligible form, ignoring individual failures
      await Promise.all(
        eligible.map((req: any) =>
          fetch(`${API_URL}/api/form-requests/${req.id}/refresh`, {
            method: 'POST',
            credentials: 'include',
          })
            .then(() => { lastRefreshTime.current[req.id] = Date.now(); })
            .catch(() => null)
        )
      );

      // Update the request list and health status in the UI
      await loadFormRequests();
      fetch(`${API_URL}/api/health`, { credentials: 'include' })
        .then((res) => res.json())
        .then((healthData: HealthResponse) => setData(healthData))
        .catch(() => {});
    } catch (error) {
      console.error('Refresh error:', error);
    } finally {
      refreshInProgress.current = false;
    }
  };

  // ── Side effects ──────────────────────────────────────────────────────────

  /**
   * Background polling effect.
   *
   * Starts a 30-second interval that calls refreshAllFormRequests() only
   * when the browser tab is visible (avoids unnecessary network traffic when
   * the user has switched away).
   *
   * Cleans up the interval when the component unmounts.
   */
  useEffect(() => {
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') refreshAllFormRequests();
    }, 30000);
    return () => clearInterval(pollInterval);
  }, []);

  // ── Derived booleans for the System Status stat card ──────────────────────

  const isHealthy: boolean = data?.status === 'healthy';
  const isDbConnected: boolean = data?.database === 'connected';

  // ── Render ────────────────────────────────────────────────────────────────

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
            Dashboard{' '}
            <AnimatedInfoButton title="Dashboard Guide">
              <div>
                <p>
                  Welcome to your <strong>FormReminder Dashboard!</strong> This page is your central hub for tracking form requests and response rates.
                </p>

                <p>
                  At the top, the <strong>Overview Cards</strong> give you a quick snapshot of active forms, total responses, your overall completion rate, and database health. 
                </p>

                <p>
                  Below, the <strong>Form Requests Panel</strong> lets you monitor individual campaigns. Each row features a progress bar showing completed versus pending responses. Click <strong>Sync Now</strong> to refresh data immediately, or use the mobile search bar to quickly find specific forms. 
                </p>

                <p>
                  Finally, use the <strong>Actions</strong> menu on any request to view detailed analytics (Eye), duplicate a successful campaign (Copy), or delete an obsolete form (Trash).
                </p>
              </div>
            </AnimatedInfoButton>
          </Typography>
          <Box display="flex" alignItems="center" gap={1}>
            <Typography variant="body2" color="text.secondary">
              Overview of your forms and responses
            </Typography>
            {/* "Up to date" chip shows the last sync time on hover */}
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

        {/* Header action buttons */}
        <Box display="flex" gap={1.5}>
          {/* Sync Now: spins the icon while a refresh is in flight */}
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
      {/* 2-column on mobile, 4-column on desktop */}
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

      {/* ── Requests Panel ── */}
      <Paper
        elevation={0}
        sx={{ 
          border: '1px solid', 
          borderColor: 'divider', 
          borderRadius: 3, 
          overflow: 'hidden',
          transition: 'box-shadow 0.3s ease-in-out',
          '&:hover': {
            boxShadow: '0 12px 32px -12px rgba(0,0,0,0.1)',
          }
        }}
      >
        {/* Panel header: title + total count chip */}
        <Box
          px={3}
          py={2}
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          sx={{ 
            borderBottom: '1px solid', 
            borderColor: 'divider', 
            background: 'linear-gradient(90deg, #f4f9ff 0%, #ffffff 100%)',
          }}
        >
          <Typography variant="subtitle1" fontWeight="bold">
            Form Requests
          </Typography>
          <Chip label={`${rows.length} total`} size="small" variant="outlined" />
        </Box>

        {/* ── Mobile view: search bar + RequestCard list ── */}
        {/* Hidden on md+ screens; DataGrid is shown instead */}
        <Box sx={{ display: { xs: 'block', md: 'none' }, p: 2 }}>

          {/* Only show search bar if there is at least one form to search */}
          {rows.length > 0 && (
            <TextField
              fullWidth
              placeholder="Search forms..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              variant="outlined"
              size="small"
              sx={{
                mb: 2.5,
                '& .MuiOutlinedInput-root': {
                  borderRadius: 3,
                  bgcolor: 'background.paper',
                  transition: 'box-shadow 0.2s',
                  '&:hover': { boxShadow: '0 4px 12px -4px rgba(0,0,0,0.1)' },
                  '&.Mui-focused': { boxShadow: '0 4px 12px -4px rgba(25, 118, 210, 0.2)' }
                }
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon color="action" />
                  </InputAdornment>
                ),
                // Show an X button to clear the search only when there is a query
                endAdornment: searchQuery ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setSearchQuery('')} edge="end">
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              }}
            />
          )}

          {/* Three possible states: no data, no search results, or a populated list */}
          {rows.length === 0 ? (
            // Empty state: user has no form requests yet
            <Box py={6} textAlign="center">
              <AssignmentIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1.5 }} />
              <Typography color="text.secondary" gutterBottom>
                No form requests yet
              </Typography>
              <Button variant="text" onClick={() => navigate('/requests/new')}>
                Create one now
              </Button>
            </Box>
          ) : filteredMobileRows.length === 0 ? (
            // Empty search results state
            <Box py={4} textAlign="center" className="fade-in">
              <Typography color="text.secondary">
                No results found for "{searchQuery}"
              </Typography>
              <Button sx={{ mt: 1 }} size="small" onClick={() => setSearchQuery('')}>
                Clear Search
              </Button>
            </Box>
          ) : (
            // Populated list of RequestCards
            <Stack spacing={1.5}>
              {filteredMobileRows.map((row) => (
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

        {/* ── Desktop view: MUI DataGrid ── */}
        {/* Hidden on xs/sm screens; RequestCard list is shown instead */}
        <Box sx={{ display: { xs: 'none', md: 'block' }, height: 500 }}>
          <DataGrid
            aria-label="Form requests"
            disableVirtualization
            rows={rows}
            columns={columns}
            // Clicking a row navigates to that request's detail page
            onRowClick={(params) => navigate(`/request/${params.row.id}`)}
            slots={{
              // Custom empty-state overlay when there are no rows
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
              // Default sort: newest requests first
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