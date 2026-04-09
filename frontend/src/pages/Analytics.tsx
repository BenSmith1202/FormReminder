import React, { useEffect, useState, useMemo } from 'react';
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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
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
import BarChartIcon from '@mui/icons-material/BarChart';
import SendIcon from '@mui/icons-material/Send';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import BlockIcon from '@mui/icons-material/Block';

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

interface SubmissionPerForm {
  request_id: string;
  form_title: string;
  submissions: number;
}

interface SubmissionAnalytics {
  per_form: SubmissionPerForm[];
  total: number;
  range: string;
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

  const [selectedFormId, setSelectedFormId] = useState<string>('__all__');
  const [timeRange, setTimeRange] = useState<string>('6m');
  const [statsLoading, setStatsLoading] = useState(false);

  const [submissionStats, setSubmissionStats] = useState<SubmissionAnalytics | null>(null);
  const [submissionRange, setSubmissionRange] = useState<string>('6m');
  const [submissionFormId, setSubmissionFormId] = useState<string>('__all__');
  const [submissionLoading, setSubmissionLoading] = useState(false);

  const loadEmailOpens = async (range: string) => {
    setStatsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/analytics/email-opens?range=${range}`, { credentials: 'include' });
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.error('Failed to load email open analytics', res.status);
      } else {
        const data: EmailOpenAnalytics = await res.json();
        setEmailOpenStats(data);
        setSelectedFormId('__all__');
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to load email open analytics', e);
    } finally {
      setStatsLoading(false);
    }
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
        loadEmailOpens(timeRange);
        loadSubmissions(submissionRange);
        loadEvents(ownerId);
      } else {
        setLoading(false);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSubmissions = async (range: string) => {
    setSubmissionLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/analytics/submissions?range=${range}`, { credentials: 'include' });
      if (res.ok) {
        const data: SubmissionAnalytics = await res.json();
        setSubmissionStats(data);
        setSubmissionFormId('__all__');
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to load submission analytics', e);
    } finally {
      setSubmissionLoading(false);
    }
  };

  // Re-fetch email open stats whenever the time range changes (skip initial mount — handled above)
  const isFirstRender = useState(true);
  useEffect(() => {
    if (isFirstRender[0]) { isFirstRender[1](false); return; }
    loadEmailOpens(timeRange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange]);

  useEffect(() => {
    loadSubmissions(submissionRange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionRange]);

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
    //const latest = latestByRecipient[(email ?? '').toLowerCase()];
    //return latest === 'opted_out' || latest === 'left_group';
    if (latestByRecipient[email.toLowerCase()] === 'opted_out') {// nothing
    };
    return false; // Temporarily disable re-subscribe action 
    //TODO: PLEASE REMOVE THIS FEATURE ENTIRELY
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

  const formOptions = useMemo(() => {
    if (!emailOpenStats) return [];
    return emailOpenStats.per_form.map((row) => ({
      id: row.request_id ?? row.form_title,
      label: row.form_title || 'Untitled',
    }));
  }, [emailOpenStats]);

  const openBarData = useMemo(() => {
    if (!emailOpenStats) return [];
    const filtered = selectedFormId === '__all__'
      ? emailOpenStats.per_form
      : emailOpenStats.per_form.filter(
          (row) => (row.request_id ?? row.form_title) === selectedFormId
        );
    return filtered.map((row) => ({
      name: row.form_title || 'Untitled',
      opens: row.opens,
    }));
  }, [emailOpenStats, selectedFormId]);

  const openLineData = useMemo(() => {
    if (!emailOpenStats) return [];
    return emailOpenStats.monthly.map((row) => ({
      label: row.label,
      opens: row.opens,
    }));
  }, [emailOpenStats]);

  const submissionFormOptions = useMemo(() => {
    if (!submissionStats) return [];
    return submissionStats.per_form.map((row) => ({
      id: row.request_id,
      label: row.form_title || 'Untitled',
    }));
  }, [submissionStats]);

  const submissionBarData = useMemo(() => {
    if (!submissionStats) return [];
    const filtered = submissionFormId === '__all__'
      ? submissionStats.per_form
      : submissionStats.per_form.filter((r) => r.request_id === submissionFormId);
    return filtered.map((r) => ({ name: r.form_title || 'Untitled', submissions: r.submissions }));
  }, [submissionStats, submissionFormId]);

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

  // ── Shared range toggle options ──────────────────────────────────────────
  const RANGE_OPTIONS = [
    { value: '7d', label: '7D' }, { value: '30d', label: '30D' },
    { value: '3m', label: '3M' }, { value: '6m', label: '6M' },
    { value: '1y', label: '1Y' }, { value: 'all', label: 'All' },
  ];
  const RANGE_LABELS: Record<string, string> = {
    '7d': 'last 7 days', '30d': 'last 30 days', '3m': 'last 3 months',
    '6m': 'last 6 months', '1y': 'last year', 'all': 'all time',
  };

  // ── Reusable section card wrapper ────────────────────────────────────────
  const sectionPaper = {
    elevation: 0,
    sx: {
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: 3,
      overflow: 'hidden',
      mb: 3,
    },
  };

  const sectionHeader = (icon: React.ReactNode, title: string, controls?: React.ReactNode) => (
    <Box
      display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}
      px={{ xs: 2, sm: 2.5 }} py={2}
      sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}
    >
      <Box display="flex" alignItems="center" gap={1.25}>
        <Box sx={{ color: 'primary.main', display: 'flex', alignItems: 'center' }}>{icon}</Box>
        <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
      </Box>
      {controls}
    </Box>
  );

  const toggleStyle = { '& .MuiToggleButton-root': { px: 1.5, py: 0.4, fontSize: '0.72rem', textTransform: 'none' } };

  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 }, maxWidth: 1200, mx: 'auto' }}>

      {/* ── Page title ── */}
      <Box display="flex" alignItems="center" gap={1} mb={3}>
        <Typography variant="h5" component="h1" fontWeight={700}>Analytics</Typography>
        <AnimatedInfoButton title="Analytics Guide">
          <p>This page provides insights into opt-out events and submission trends for your forms.</p>
        </AnimatedInfoButton>
      </Box>

      {/* ── Stat cards ── */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: { xs: 1.5, sm: 2 }, mb: 3 }}>
        {[
          {
            label: 'EMAILS SENT',
            value: emailOpenStats?.total_sent ?? '—',
            sub: 'Total successfully delivered',
            icon: <SendIcon fontSize="small" />,
          },
          {
            label: 'OPEN RATE',
            value: emailOpenStats != null ? `${emailOpenStats.open_rate}%` : '—',
            sub: emailOpenStats != null
              ? `${emailOpenStats.unique_opens} unique opener${emailOpenStats.unique_opens !== 1 ? 's' : ''}`
              : 'Of emails delivered',
            icon: <TrendingUpIcon fontSize="small" />,
          },
          {
            label: 'TOTAL SUBMISSIONS',
            value: submissionStats?.total ?? '—',
            sub: `In ${RANGE_LABELS[submissionRange] ?? submissionRange}`,
            icon: <AssignmentTurnedInIcon fontSize="small" />,
          },
        ].map(({ label, value, sub, icon }) => (
          <Box key={label} sx={{ flex: { xs: '1 1 calc(33% - 8px)', sm: '1 1 180px' }, minWidth: 140 }}>
            <Card elevation={0} sx={{
              height: '100%', borderRadius: 3, border: '1px solid', borderColor: 'divider',
              background: 'linear-gradient(135deg, #f4f9ff 0%, #ffffff 100%)',
              transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
              boxShadow: '0 4px 10px -4px rgba(0,0,0,0.1)',
              '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 12px 24px -10px rgba(0,0,0,0.2)' },
            }}>
              <CardContent sx={{ p: { xs: 2, sm: 2.5 }, '&:last-child': { pb: { xs: 2, sm: 2.5 } } }}>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                  <Box>
                    <Typography variant="caption" color="text.secondary" fontWeight="bold" display="block" gutterBottom>
                      {label}
                    </Typography>
                    <Typography variant="h4" component="p" fontWeight="bold" lineHeight={1}>{value}</Typography>
                    <Typography variant="body2" color="text.secondary" mt={0.75}>{sub}</Typography>
                  </Box>
                  <Box sx={{ width: 44, height: 44, borderRadius: 2, bgcolor: 'grey.100', color: 'text.secondary', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {icon}
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Box>
        ))}
      </Box>

      {/* ── Email open analytics ── */}
      <Paper {...sectionPaper}>
        {sectionHeader(
          <SendIcon fontSize="small" />,
          'Email Open Analytics',
          <ToggleButtonGroup size="small" value={timeRange} exclusive
            onChange={(_e, val) => { if (val) setTimeRange(val); }} sx={toggleStyle}>
            {RANGE_OPTIONS.map(({ value, label }) => (
              <ToggleButton key={value} value={value}>{label}</ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
        <Box sx={{ position: 'relative' }}>
          {statsLoading && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(255,255,255,0.7)', zIndex: 1 }}>
              <CircularProgress size={32} />
            </Box>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
            {/* Bar chart */}
            <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 50%' }, minWidth: 0, borderRight: { md: '1px solid' }, borderColor: { md: 'divider' }, p: { xs: 2, sm: 2.5 } }}>
              <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={1.5}>
                <Typography variant="body2" fontWeight={600} color="text.secondary">Opens per form</Typography>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="form-filter-label">Form</InputLabel>
                  <Select labelId="form-filter-label" label="Form" value={selectedFormId}
                    onChange={(e: SelectChangeEvent) => setSelectedFormId(e.target.value)}>
                    <MenuItem value="__all__">All forms</MenuItem>
                    {formOptions.map((opt) => (
                      <MenuItem key={opt.id} value={opt.id ?? ''}>{opt.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
              {openBarData.length === 0 ? (
                <Box sx={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography variant="body2" color="text.secondary">No open data for this period.</Typography>
                </Box>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={openBarData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 12 }} />
                    <Bar dataKey="opens" fill="#43a047" name="Opens" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Box>
            {/* Line chart */}
            <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 50%' }, minWidth: 0, p: { xs: 2, sm: 2.5 } }}>
              <Typography variant="body2" fontWeight={600} color="text.secondary" mb={1.5}>
                Opens over time — {RANGE_LABELS[timeRange] ?? timeRange}
              </Typography>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={openLineData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="opens" name="Opens" stroke="#43a047" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </Box>
        </Box>
      </Paper>

      {/* ── Submissions per form ── */}
      <Paper {...sectionPaper}>
        {sectionHeader(
          <AssignmentTurnedInIcon fontSize="small" />,
          'Submissions per Form',
          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel id="sub-form-label">Form</InputLabel>
              <Select labelId="sub-form-label" label="Form" value={submissionFormId}
                onChange={(e: SelectChangeEvent) => setSubmissionFormId(e.target.value)}>
                <MenuItem value="__all__">All forms</MenuItem>
                {submissionFormOptions.map((opt) => (
                  <MenuItem key={opt.id} value={opt.id}>{opt.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <ToggleButtonGroup size="small" value={submissionRange} exclusive
              onChange={(_e, val) => { if (val) setSubmissionRange(val); }} sx={toggleStyle}>
              {RANGE_OPTIONS.map(({ value, label }) => (
                <ToggleButton key={value} value={value}>{label}</ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
        )}
        <Box sx={{ p: { xs: 2, sm: 2.5 }, position: 'relative' }}>
          {submissionLoading && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(255,255,255,0.7)', zIndex: 1 }}>
              <CircularProgress size={28} />
            </Box>
          )}
          {submissionBarData.length === 0 ? (
            <Box sx={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="body2" color="text.secondary">No submissions recorded for this period.</Typography>
            </Box>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={submissionBarData} margin={{ top: 4, right: 8, left: -10, bottom: submissionBarData.length > 4 ? 40 : 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                  interval={0} angle={submissionBarData.length > 4 ? -30 : 0}
                  textAnchor={submissionBarData.length > 4 ? 'end' : 'middle'} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 12 }} />
                <Bar dataKey="submissions" fill="#1976d2" name="Submissions" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Box>
      </Paper>

      {/* ── Opted-Out Recipients ── */}
      <Paper {...sectionPaper} sx={{ ...sectionPaper.sx, mb: 0 }}>
        {sectionHeader(<BlockIcon fontSize="small" />, 'Opted-Out Recipients')}
        <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
          {isMobile ? (
            <Box>
              {rows.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  No opt-out events recorded.
                </Typography>
              ) : (
                rows.map((row, idx) => (
                  <Box key={row.id}>
                    {idx > 0 && <Divider sx={{ my: 1 }} />}
                    <Box sx={{ py: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, mb: 0.75 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-all', flex: 1, fontSize: '0.8rem' }}>
                          {row.recipient_email}
                        </Typography>
                        <Chip label={row.event_type} color={getEventTypeChipColor(row.event_type)} size="small" variant="outlined" sx={{ flexShrink: 0 }} />
                      </Box>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 0.75 }}>
                        {row.group_name && <Typography variant="caption" color="text.secondary">Group: <strong>{row.group_name}</strong></Typography>}
                        {row.source && <Typography variant="caption" color="text.secondary">Source: <strong>{row.source}</strong></Typography>}
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="caption" color="text.secondary">{formatTimestamp(row.timestamp)}</Typography>
                        {canResubscribe(row.recipient_email) && (
                          <Button size="small" variant="outlined" disabled={resubscribingEmail === row.recipient_email}
                            onClick={() => handleResubscribe(row.recipient_email)}
                            startIcon={resubscribingEmail === row.recipient_email ? <CircularProgress size={12} /> : undefined}
                            sx={{ fontSize: '0.7rem', py: 0.25, px: 1 }}>
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
            <Box sx={{ height: 400, width: '100%' }}>
              <DataGrid aria-label="Opted-out recipients" disableVirtualization rows={rows} columns={columns}
                initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
                pageSizeOptions={[5, 10, 25]} disableRowSelectionOnClick
                sx={{ border: 'none', '& .MuiDataGrid-columnHeaders': { bgcolor: 'grey.50' } }}
              />
            </Box>
          )}
        </Box>
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
