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
  Divider,
  useTheme,
  useMediaQuery,
  Dialog,
  DialogContent,
  DialogActions,
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
import BarChartIcon from '@mui/icons-material/BarChart';

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

interface EmailOpenPerForm {
  request_id: string | null;
  form_title: string;
  opens: number;
}

interface EmailOpenMonthly {
  month: string;
  label: string;
  opens: number;
}

interface EmailOpenAnalytics {
  total_opens: number;
  unique_opens: number;
  opens_this_month: number;
  total_sent: number;
  open_rate: number;
  unique_open_rate: number;
  per_form: EmailOpenPerForm[];
  monthly: EmailOpenMonthly[];
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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [user, setUser] = useState<{ id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emailOpenStats, setEmailOpenStats] = useState<EmailOpenAnalytics | null>(null);
  const [events, setEvents] = useState<OptOutEventRow[]>([]);
  const [resubscribingEmail, setResubscribingEmail] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; isError?: boolean }>({ open: false, message: '' });

  // One-time welcome dialog — only shown to new users who haven't seen it before
  const [showWelcome, setShowWelcome] = useState<boolean>(
    () => !localStorage.getItem('fr_welcome_analytics_seen')
  );

  const dismissWelcome = () => {
    setShowWelcome(false);
    localStorage.setItem('fr_welcome_analytics_seen', 'true');
  };

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
      } catch {
        setError('Failed to load user');
        return null;
      }
    };

    const loadEmailOpens = async () => {
      try {
        const res = await fetch(`${API_URL}/api/analytics/email-opens`, { credentials: 'include' });
        if (!res.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to load email open analytics', res.status);
        } else {
          const data: EmailOpenAnalytics = await res.json();
          setEmailOpenStats(data);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to load email open analytics', e);
      }
    };

    const loadEvents = async (ownerId: string) => {
      try {
        const res = await fetch(`${API_URL}/api/organizations/${ownerId}/opt-out-events`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setEvents(Array.isArray(data?.events) ? data.events : []);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to load opt-out events', e);
      } finally {
        setLoading(false);
      }
    };

    loadUser().then((ownerId) => {
      if (ownerId) {
        loadEmailOpens();
        loadEvents(ownerId);
      } else {
        setLoading(false);
      }
    });
  }, []);

  const refreshEvents = async () => {
    if (!user?.id) return;
    try {
      const res = await fetch(`${API_URL}/api/organizations/${user.id}/opt-out-events`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setEvents(Array.isArray(data.events) ? data.events : []);
      }
    } catch {
      // non-fatal
    }
  };

  const latestByRecipient = useMemo(() => {
    const map: Record<string, string> = {};
    const sorted = [...events].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    for (const e of sorted) {
      const key = (e.recipient_email ?? '').toLowerCase();
      if (key && map[key] === undefined) map[key] = e.event_type;
    }
    return map;
  }, [events]);

  const canResubscribe = (email: string) => {
    const latest = latestByRecipient[(email ?? '').toLowerCase()];
    return latest === 'opted_out' || latest === 'left_group';
  };

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

  const rows = useMemo(
    () => events.map((e) => ({
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

  const columns: GridColDef[] = useMemo(
    () => [
      { field: 'recipient_email', headerName: 'Email', flex: 1, minWidth: 180 },
      {
        field: 'event_type',
        headerName: 'Event Type',
        width: 145,
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
        valueGetter: (_: unknown, row: OptOutEventRow) => row.group_name ?? '—',
      },
      { field: 'source', headerName: 'Source', width: 120 },
      { field: 'performed_by', headerName: 'Performed By', width: 120 },
      {
        field: 'timestamp',
        headerName: 'Timestamp',
        width: 185,
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
    [latestByRecipient, resubscribingEmail]
  );

  const openBarData = useMemo(() => {
    if (!emailOpenStats) return [];
    return emailOpenStats.per_form.map((row) => ({
      name: row.form_title || 'Untitled',
      opens: row.opens,
    }));
  }, [emailOpenStats]);

  const openLineData = useMemo(() => {
    if (!emailOpenStats) return [];
    return emailOpenStats.monthly.map((row) => ({
      label: row.label,
      opens: row.opens,
    }));
  }, [emailOpenStats]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 5 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
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

      {/* ── Stat cards ── */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: { xs: 1.5, sm: 2 }, mb: 3 }}>
        {[
          { label: 'Emails sent', value: emailOpenStats?.total_sent ?? '—', highlight: false },
          { label: 'Open rate', value: emailOpenStats != null ? `${emailOpenStats.open_rate}%` : '—', highlight: true },
        ].map(({ label, value, highlight }) => (
          <Box key={label} sx={{ flex: { xs: '1 1 calc(50% - 6px)', sm: '1 1 200px' }, minWidth: 0 }}>
            <Card
              sx={{
                height: '100%',
                borderColor: highlight ? 'primary.main' : undefined,
                borderWidth: highlight ? 2 : 1,
                borderStyle: 'solid',
              }}
            >
              <CardContent sx={{ p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
                <Typography
                  color="text.secondary"
                  variant="body2"
                  gutterBottom
                  sx={{ fontSize: { xs: '0.7rem', sm: '0.875rem' }, lineHeight: 1.3 }}
                >
                  {label}
                </Typography>
                <Typography
                  component="p"
                  sx={{
                    fontSize: { xs: '1.5rem', sm: '2.125rem' },
                    fontWeight: 700,
                    lineHeight: 1.2,
                    color: highlight ? 'primary.main' : 'text.primary',
                  }}
                >
                  {value}
                </Typography>
              </CardContent>
            </Card>
          </Box>
        ))}
      </Box>

      {/* ── Open rate charts ── */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 400px' }, minWidth: 0 }}>
          <Paper sx={{ p: { xs: 1.5, sm: 2 }, height: { xs: 280, sm: 320 } }}>
            <Typography variant="subtitle1" gutterBottom>Email opens per form</Typography>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={openBarData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="opens" fill="#43a047" name="Opens" />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Box>
        <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 400px' }, minWidth: 0 }}>
          <Paper sx={{ p: { xs: 1.5, sm: 2 }, height: { xs: 280, sm: 320 } }}>
            <Typography variant="subtitle1" gutterBottom>Email opens over time (last 6 months)</Typography>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={openLineData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="opens" name="Opens" stroke="#43a047" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </Paper>
        </Box>
      </Box>

      {/* ── Opted-Out Recipients ── */}
      <Paper sx={{ p: { xs: 1.5, sm: 2 }, overflow: 'hidden' }}>
        <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>
          Opted-Out Recipients
        </Typography>

        {isMobile ? (
          /* ── Mobile: one card per row ── */
          <Box>
            {rows.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                No opt-out events recorded.
              </Typography>
            ) : (
              rows.map((row, idx) => (
                <Box key={row.id}>
                  {idx > 0 && <Divider sx={{ my: 1 }} />}
                  <Box sx={{ py: 1 }}>
                    {/* Email + chip */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, mb: 0.75 }}>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 600, wordBreak: 'break-all', flex: 1, fontSize: '0.8rem' }}
                      >
                        {row.recipient_email}
                      </Typography>
                      <Chip
                        label={row.event_type}
                        color={getEventTypeChipColor(row.event_type)}
                        size="small"
                        variant="outlined"
                        sx={{ flexShrink: 0 }}
                      />
                    </Box>

                    {/* Group / source */}
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 0.75 }}>
                      {row.group_name && (
                        <Typography variant="caption" color="text.secondary">
                          Group: <strong>{row.group_name}</strong>
                        </Typography>
                      )}
                      {row.source && (
                        <Typography variant="caption" color="text.secondary">
                          Source: <strong>{row.source}</strong>
                        </Typography>
                      )}
                    </Box>

                    {/* Timestamp + re-subscribe */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="caption" color="text.secondary">
                        {formatTimestamp(row.timestamp)}
                      </Typography>
                      {canResubscribe(row.recipient_email) && (
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={resubscribingEmail === row.recipient_email}
                          onClick={() => handleResubscribe(row.recipient_email)}
                          startIcon={resubscribingEmail === row.recipient_email ? <CircularProgress size={12} /> : undefined}
                          sx={{ fontSize: '0.7rem', py: 0.25, px: 1 }}
                        >
                          {resubscribingEmail === row.recipient_email ? 'Sending...' : 'Re-subscribe'}
                        </Button>
                      )}
                    </Box>
                  </Box>
                </Box>
              ))
            )}
          </Box>
        ) : (
          /* ── Desktop: DataGrid ── */
          <Box sx={{ height: 400, width: '100%' }}>
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
        )}
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

      {/* ── One-time welcome dialog for new users ── */}
      <Dialog
        open={showWelcome}
        onClose={dismissWelcome}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3, p: { xs: 1, sm: 2 } } }}
      >
        <DialogContent sx={{ textAlign: 'center', pt: { xs: 3, sm: 4 } }}>
          <Box
            sx={{
              width: 56, height: 56, borderRadius: '50%', bgcolor: 'primary.50',
              display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2,
            }}
          >
            <BarChartIcon sx={{ fontSize: 28, color: 'primary.main' }} />
          </Box>
          <Typography variant="h5" fontWeight="bold" gutterBottom>
            Welcome to Analytics!
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 420, mx: 'auto' }}>
            Here you can track patterns and trends for your forms. View submission statistics,
            monitor opt-out events, and export data to gain insights into how your recipients
            are engaging with your form requests.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center', pb: 3 }}>
          <Button variant="contained" size="large" onClick={dismissWelcome} sx={{ px: 5 }}>
            Continue
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}
