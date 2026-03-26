import { useEffect, useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Alert,
  Card,
  CardContent,
  Button,
  Chip,
  Snackbar,
} from '@mui/material';
import { DataGrid, type GridColDef, type GridRenderCellParams } from '@mui/x-data-grid';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import FileDownloadIcon from '@mui/icons-material/FileDownload';

import API_URL from '../config';
import AnimatedInfoButton from '../components/InfoButton';

interface OptOutEventRow {
  id: string;
  recipient_email: string;
  event_type: string;
  group_id: string | null;
  group_name: string | null;
  performed_by: string;
  source: string;
  timestamp: string;
}

interface SubmissionPerFormRow {
  form_request_id: string;
  form_title: string;
  count: number;
}

interface SubmissionMonthlyRow {
  month: string;
  label: string;
  count: number;
}

interface SubmissionAnalytics {
  total_submissions: number;
  submissions_this_month: number;
  per_form: SubmissionPerFormRow[];
  monthly: SubmissionMonthlyRow[];
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const h = d.getHours();
    const am = h < 12;
    const h12 = h % 12 || 12;
    const m = d.getMinutes();
    const pad = (n: number) => (n < 10 ? '0' + n : String(n));
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${h12}:${pad(m)} ${am ? 'a' : 'p'}m`;
  } catch {
    return ts;
  }
}

function getEventTypeChipColor(eventType: string): 'error' | 'warning' | 'success' | 'default' {
  if (eventType === 'opted_out') return 'error';
  if (eventType === 'left_group') return 'warning';
  if (eventType === 'resubscribed' || eventType === 'added_back_by_owner') return 'success';
  return 'default';
}

export default function Analytics() {
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [events, setEvents] = useState<OptOutEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; isError?: boolean }>({ open: false, message: '' });
  const [resubscribingEmail, setResubscribingEmail] = useState<string | null>(null);
  const [submissionStats, setSubmissionStats] = useState<SubmissionAnalytics | null>(null);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const res = await fetch(`${API_URL}/api/current-user`, { credentials: 'include' });
        const raw = await res.json();
        const data = Array.isArray(raw) && raw.length > 0 ? raw[0] : raw;
        if (data?.authenticated && data?.user?.id) {
          setUser(data.user);
          return data.user.id;
        }
        setError('Not authenticated');
        return null;
      } catch (e) {
        setError('Failed to load user');
        return null;
      }
    };

    const loadEvents = async (ownerId: string) => {
      try {
        const res = await fetch(`${API_URL}/api/organizations/${ownerId}/opt-out-events`, {
          credentials: 'include',
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody?.error || `Failed to load events (${res.status})`);
        }
        const data = await res.json();
        setEvents(Array.isArray(data?.events) ? data.events : []);
      } catch (e: any) {
        setError(e.message || 'Failed to load events');
        setEvents([]);
      } finally {
        setLoading(false);
      }
    };

    const loadSubmissions = async () => {
      try {
        const res = await fetch(`${API_URL}/api/analytics/submissions-over-time`, {
          credentials: 'include',
        });
        if (!res.ok) {
          // Do not override existing error state with this; just log for debugging.
          // eslint-disable-next-line no-console
          console.error('Failed to load submissions analytics', res.status);
          return;
        }
        const data: SubmissionAnalytics = await res.json();
        setSubmissionStats(data);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to load submissions analytics', e);
      }
    };

    loadUser().then((ownerId) => {
      if (ownerId) {
        loadEvents(ownerId);
        loadSubmissions();
      } else {
        setLoading(false);
      }
    });
  }, []);

  const refreshEvents = async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/organizations/${user.id}/opt-out-events`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load events');
      const data = await res.json();
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch (e: any) {
      setError(e.message || 'Failed to load events');
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let totalOptOuts = 0;
    let optOutsThisMonth = 0;
    let totalResubscribes = 0;
    const latestByRecipient: Record<string, string> = {};
    const sorted = [...events].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    for (const e of sorted) {
      const email = e.recipient_email?.toLowerCase?.() ?? '';
      if (email && latestByRecipient[email] === undefined) {
        latestByRecipient[email] = e.event_type;
      }
      if (e.event_type === 'opted_out') {
        totalOptOuts++;
        if (new Date(e.timestamp) >= thisMonthStart) optOutsThisMonth++;
      } else if (e.event_type === 'added_back_by_owner' || e.event_type === 'resubscribed') {
        totalResubscribes++;
      }
    }
    let activeOptedOut = 0;
    for (const et of Object.values(latestByRecipient)) {
      if (et === 'opted_out' || et === 'left_group') activeOptedOut++;
    }
    return {
      totalOptOuts,
      optOutsThisMonth,
      totalResubscribes,
      activeOptedOut,
      latestByRecipient,
    };
  }, [events]);

  const barData = useMemo(() => {
    if (!submissionStats) return [];
    return submissionStats.per_form.map((row) => ({
      name: row.form_title || 'Untitled',
      count: row.count,
    }));
  }, [submissionStats]);

  const lineData = useMemo(() => {
    if (!submissionStats) return [];
    return submissionStats.monthly.map((row) => ({
      month: row.month,
      label: row.label,
      submissions: row.count,
    }));
  }, [submissionStats]);

  const handleResubscribe = async (email: string) => {
    if (!user?.id) return;
    setResubscribingEmail(email);
    try {
      const res = await fetch(`${API_URL}/api/organizations/${user.id}/resubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSnackbar({ open: true, message: data.error || 'Failed to re-subscribe', isError: true });
        return;
      }
      setSnackbar({ open: true, message: 'Recipient re-subscribed successfully' });
      refreshEvents();
    } catch (e: any) {
      setSnackbar({ open: true, message: e.message || 'Failed to re-subscribe', isError: true });
    } finally {
      setResubscribingEmail(null);
    }
  };

  const canResubscribe = (email: string) => {
    const latest = stats.latestByRecipient[email?.toLowerCase?.() ?? ''];
    return latest === 'opted_out' || latest === 'left_group';
  };

  const handleExportCsv = () => {
    const headers = ['Email', 'Event Type', 'Group', 'Source', 'Performed By', 'Timestamp'];
    const rows = events.map((e) => [
      e.recipient_email ?? '',
      e.event_type ?? '',
      e.group_name ?? '',
      e.source ?? '',
      e.performed_by ?? '',
      formatTimestamp(e.timestamp),
    ]);
    const escape = (v: string) => {
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `opt-out-events-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: GridColDef[] = useMemo(
    () => [
      { field: 'recipient_email', headerName: 'Email', flex: 1, minWidth: 180 },
      {
        field: 'event_type',
        headerName: 'Event Type',
        width: 140,
        renderCell: (params: GridRenderCellParams) => (
          <Chip
            label={params.value}
            color={getEventTypeChipColor(params.value as string)}
            size="small"
            variant="outlined"
          />
        ),
      },
      {
        field: 'group_name',
        headerName: 'Group',
        width: 140,
        valueGetter: (_, row) => row.group_name ?? '—',
      },
      { field: 'source', headerName: 'Source', width: 120 },
      { field: 'performed_by', headerName: 'Performed By', width: 110 },
      {
        field: 'timestamp',
        headerName: 'Timestamp',
        width: 180,
        valueFormatter: (value: string) => formatTimestamp(value),
      },
      {
        field: 'action',
        headerName: 'Action',
        width: 130,
        sortable: false,
        renderCell: (params: GridRenderCellParams) => {
          const email = params.row.recipient_email as string;
          if (!canResubscribe(email)) return null;
          const busy = resubscribingEmail === email;
          return (
            <Button
              size="small"
              variant="outlined"
              disabled={busy}
              onClick={() => handleResubscribe(email)}
              startIcon={busy ? <CircularProgress size={14} /> : undefined}
            >
              {busy ? 'Sending...' : 'Re-subscribe'}
            </Button>
          );
        },
      },
    ],
    [stats.latestByRecipient, resubscribingEmail]
  );

  const rows = useMemo(
    () =>
      events.map((e) => ({
        id: e.id,
        recipient_email: e.recipient_email,
        event_type: e.event_type,
        group_name: e.group_name,
        group_id: e.group_id,
        source: e.source,
        performed_by: e.performed_by,
        timestamp: e.timestamp,
      })),
    [events]
  );

  if (loading && events.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 5 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error && events.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h5" component="h1" gutterBottom>Analytics</Typography>
        <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ px: { xs: 1, sm: 2 }, py: 2 }}>
      <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 600 }}>
        Analytics <AnimatedInfoButton title="Analytics Guide">
                    <p>This page provides insights into opt-out events and submission trends for your forms.</p>
                  </AnimatedInfoButton>
      </Typography>
      {events.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Showing data for your account. No opt-out events have been recorded yet. Events are added when recipients
          unsubscribe from reminder emails, when you remove someone from a group, or when you re-subscribe someone here.
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 200px' }, minWidth: 0 }}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" variant="body2" gutterBottom>Total opt-outs (all time)</Typography>
              <Typography variant="h4" component="p">{stats.totalOptOuts}</Typography>
            </CardContent>
          </Card>
        </Box>
        <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 200px' }, minWidth: 0 }}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" variant="body2" gutterBottom>Opt-outs this month</Typography>
              <Typography variant="h4" component="p">{stats.optOutsThisMonth}</Typography>
            </CardContent>
          </Card>
        </Box>
        <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 200px' }, minWidth: 0 }}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" variant="body2" gutterBottom>Total re-subscribes (all time)</Typography>
              <Typography variant="h4" component="p">{stats.totalResubscribes}</Typography>
            </CardContent>
          </Card>
        </Box>
        <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 200px' }, minWidth: 0 }}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" variant="body2" gutterBottom>Active opted-out count</Typography>
              <Typography variant="h4" component="p">{stats.activeOptedOut}</Typography>
            </CardContent>
          </Card>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 400px' }, minWidth: 0 }}>
          <Paper sx={{ p: { xs: 1.5, sm: 2 }, height: { xs: 280, sm: 320 } }}>
            <Typography variant="subtitle1" gutterBottom>Submissions per form</Typography>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#1976d2" name="Submissions" />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Box>
        <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 400px' }, minWidth: 0 }}>
          <Paper sx={{ p: { xs: 1.5, sm: 2 }, height: { xs: 280, sm: 320 } }}>
            <Typography variant="subtitle1" gutterBottom>Submissions over time (last 6 months)</Typography>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={lineData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="submissions" name="Submissions" stroke="#1976d2" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </Paper>
        </Box>
      </Box>

      <Paper sx={{ p: { xs: 1.5, sm: 2 }, mb: 2, overflow: 'hidden' }}>
        <Typography variant="subtitle1" gutterBottom>Opted-Out Recipients</Typography>
        <Box sx={{ height: { xs: 350, sm: 400 }, width: '100%', overflowX: 'auto', minWidth: 0 }}>
          <Box sx={{ minWidth: 800, height: '100%' }}>
            <DataGrid
              aria-label="Opted-out recipients"
              disableVirtualization
              rows={rows}
              columns={columns}
              initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
              pageSizeOptions={[5, 10, 25]}
              disableRowSelectionOnClick
            />
          </Box>
        </Box>
        <Button
          variant="outlined"
          startIcon={<FileDownloadIcon />}
          onClick={handleExportCsv}
          sx={{ mt: 2 }}
          fullWidth
        >
          Export to CSV
        </Button>
      </Paper>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        message={snackbar.message}
        ContentProps={{
          sx: snackbar.isError ? { bgcolor: 'error.main', color: 'white' } : undefined,
        }}
      />
    </Box>
  );
}
