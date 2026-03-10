import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Paper,
  Typography,
  Box,
  CircularProgress,
  Button,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Link,
  Tooltip,
  Snackbar,
  Container,
  Avatar,
  LinearProgress,
  Skeleton,
  InputAdornment,
  TextField,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import EmailIcon from '@mui/icons-material/Email';
import SendIcon from '@mui/icons-material/Send';
import EditIcon from '@mui/icons-material/Edit';
import EventIcon from '@mui/icons-material/Event';
import ScheduleIcon from '@mui/icons-material/Schedule';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import LinkIcon from '@mui/icons-material/Link';
import SearchIcon from '@mui/icons-material/Search';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AssignmentIcon from '@mui/icons-material/Assignment';

const API_URL = 'http://localhost:5000';

interface FormRequest {
  id: string;
  title: string;
  description: string;
  form_url: string;
  response_count: number;
  total_recipients: number;
  created_at: string;
  last_synced_at: string;
  status: string;
  warnings?: string[];
  due_date?: string;
  reminder_schedule?: string | { schedule_type: string; [key: string]: any };
}

interface Response {
  id: string;
  respondent_email: string;
  submitted_at: string;
  response_id: string;
  is_member?: boolean;
}

interface MemberStatus {
  email: string;
  status: 'responded' | 'not_responded';
  submitted_at?: string;
}

export default function ViewRequest() {
  const { requestId } = useParams<{ requestId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formRequest, setFormRequest] = useState<FormRequest | null>(null);
  const [nonMemberResponses, setNonMemberResponses] = useState<Response[]>([]);
  const [memberStatus, setMemberStatus] = useState<MemberStatus[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState(0);
  const [sendingEmail, setSendingEmail] = useState<string | null>(null);
  const [sendingBulk, setSendingBulk] = useState(false);
  const [addingEmail, setAddingEmail] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  const loadFormRequestData = async () => {
    try {
      if (!formRequest) setLoading(true);
      setError(null);
      const response = await fetch(
        `${API_URL}/api/form-requests/${requestId}/responses`,
        { credentials: 'include' }
      );
      if (!response.ok) throw new Error(`Failed to load form request: ${response.status}`);
      const data = await response.json();
      setFormRequest(data.form_request);
      setNonMemberResponses(data.non_member_responses || []);
      setMemberStatus(data.member_status || []);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message || 'Failed to load form request');
    } finally {
      setLoading(false);
    }
  };

  const handleSendReminder = async (email: string) => {
    if (!window.confirm(`Send a reminder email to ${email}?`)) return;
    setSendingEmail(email);
    try {
      const response = await fetch(
        `${API_URL}/api/form-requests/${requestId}/send-reminder/${encodeURIComponent(email)}`,
        { method: 'POST', credentials: 'include' }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to send reminder');
      setSnackbar({ open: true, message: result.message || 'Reminder sent!', severity: 'success' });
    } catch (err: any) {
      setSnackbar({ open: true, message: `Failed: ${err.message}`, severity: 'error' });
    } finally {
      setSendingEmail(null);
    }
  };

  const handleSendBulkReminders = async () => {
    const nonResponders = memberStatus.filter((m) => m.status === 'not_responded');
    if (nonResponders.length === 0) {
      alert('All members have already responded!');
      return;
    }
    if (!window.confirm(`Send reminder emails to all ${nonResponders.length} non-responders?`)) return;
    setSendingBulk(true);
    try {
      const response = await fetch(
        `${API_URL}/api/form-requests/${requestId}/send-reminders`,
        { method: 'POST', credentials: 'include' }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to send reminders');
      setSnackbar({
        open: true,
        message: `Sent: ${result.sent} · Skipped: ${result.skipped} · Failed: ${result.failed}`,
        severity: 'success',
      });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSendingBulk(false);
    }
  };

  const handleAddEmailToGroup = async (email: string) => {
    setAddingEmail(email);
    try {
      const response = await fetch(
        `${API_URL}/api/form-requests/${requestId}/add-email-to-group`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email }),
        }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to add email');
      setSnackbar({ open: true, message: result.message, severity: 'success' });
      loadFormRequestData();
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setAddingEmail(null);
    }
  };

  const getScheduleLabel = (
    schedule?: string | { schedule_type: string; [key: string]: any }
  ) => {
    const type =
      typeof schedule === 'object' && schedule !== null ? schedule.schedule_type : schedule;
    switch (type) {
      case 'gentle': return 'Gentle (3, 1 days before)';
      case 'normal': return 'Normal (5, 3, 1 days before)';
      case 'frequent': return 'Frequent (Daily last week)';
      case 'custom': return 'Custom Schedule';
      default: return type || 'Not set';
    }
  };

  useEffect(() => {
    if (requestId) loadFormRequestData();
  }, [requestId]);

  useEffect(() => {
    if (!requestId) return;
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetch(`${API_URL}/api/form-requests/${requestId}/refresh`, {
          method: 'POST',
          credentials: 'include',
        })
          .then(() => loadFormRequestData())
          .catch(console.error);
      }
    }, 30000);
    return () => clearInterval(pollInterval);
  }, [requestId]);

  useEffect(() => {
    if (!lastUpdated) return;
    const timer = setInterval(() => {
      setSecondsSinceUpdate(Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [lastUpdated]);

  const filteredMembers = memberStatus.filter((m) =>
    m.email.toLowerCase().includes(memberSearch.toLowerCase())
  );
  const nonResponderCount = memberStatus.filter((m) => m.status === 'not_responded').length;
  const responseRate =
    formRequest && formRequest.total_recipients > 0
      ? Math.round((formRequest.response_count / formRequest.total_recipients) * 100)
      : 0;

  // ── Loading ──
  if (loading && !formRequest) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Skeleton variant="rectangular" height={220} sx={{ borderRadius: 3, mb: 3 }} />
        <Skeleton variant="rectangular" height={400} sx={{ borderRadius: 3 }} />
      </Container>
    );
  }

  if (error || !formRequest) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/')} sx={{ mb: 2, color: 'text.secondary' }}>
          Back to Dashboard
        </Button>
        <Alert severity="error">{error || 'Form request not found'}</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* ── Back nav ── */}
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate('/')}
        sx={{ color: 'text.secondary', mb: 3 }}
      >
        Back to Dashboard
      </Button>

      {/* ── Warnings ── */}
      {formRequest.warnings && formRequest.warnings.length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {formRequest.warnings.join(', ')}
        </Alert>
      )}

      {/* ── Hero Header Card ── */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 3, sm: 4 },
          mb: 3,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 3,
          background: 'linear-gradient(135deg, #f0f4ff 0%, #ffffff 60%)',
        }}
      >
        {/* Title row */}
        <Box
          display="flex"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          justifyContent="space-between"
          flexWrap="wrap"
          gap={2}
          mb={3}
        >
          <Box display="flex" alignItems="center" gap={2}>
            <Box
              sx={{
                width: { xs: 48, sm: 60 },
                height: { xs: 48, sm: 60 },
                borderRadius: 2.5,
                bgcolor: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <AssignmentIcon sx={{ color: 'white', fontSize: { xs: 26, sm: 32 } }} />
            </Box>
            <Box>
              <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                <Typography variant="h5" fontWeight="bold" lineHeight={1.2}>
                  {formRequest.title}
                </Typography>
                <Chip
                  label={formRequest.status}
                  size="small"
                  color={formRequest.status === 'Active' ? 'success' : 'default'}
                  sx={{ fontWeight: 600 }}
                />
              </Box>
              <Typography variant="body2" color="text.secondary" mt={0.5}>
                {formRequest.description || 'No description provided.'}
              </Typography>
            </Box>
          </Box>
          <Button
            variant="contained"
            startIcon={<EditIcon />}
            onClick={() => navigate(`/requests/${requestId}/edit`)}
            sx={{ flexShrink: 0 }}
          >
            Edit Request
          </Button>
        </Box>

        {/* Response rate bar */}
        <Box mb={3}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
            <Typography variant="body2" fontWeight="medium">
              Response Progress
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <strong>{formRequest.response_count}</strong> / {formRequest.total_recipients} &nbsp;·&nbsp; {responseRate}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={responseRate}
            color={responseRate === 100 ? 'success' : 'primary'}
            sx={{ height: 8, borderRadius: 4, bgcolor: 'action.hover' }}
          />
        </Box>

        {/* Meta row */}
        <Box
          display="flex"
          flexWrap="wrap"
          gap={{ xs: 2, sm: 4 }}
          sx={{ pt: 3, borderTop: '1px solid', borderColor: 'divider' }}
        >
          <Box display="flex" alignItems="center" gap={1}>
            <EventIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
            <Typography variant="body2" color="text.secondary">
              Due{' '}
              <strong>
                {formRequest.due_date
                  ? new Date(formRequest.due_date).toLocaleDateString()
                  : 'not set'}
              </strong>
            </Typography>
          </Box>
          <Box display="flex" alignItems="center" gap={1}>
            <ScheduleIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
            <Typography variant="body2" color="text.secondary">
              {getScheduleLabel(formRequest.reminder_schedule)}
            </Typography>
          </Box>
          <Box
            display="flex"
            alignItems="center"
            gap={1}
            sx={{ ml: { xs: 0, sm: 'auto' } }}
          >
            <LinkIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
            <Link
              href={formRequest.form_url}
              target="_blank"
              rel="noopener"
              underline="hover"
              variant="body2"
              sx={{
                maxWidth: { xs: 180, sm: 300 },
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'block',
              }}
            >
              {formRequest.form_url}
            </Link>
          </Box>
        </Box>

        {lastUpdated && (
          <Typography variant="caption" color="text.disabled" display="block" mt={2}>
            Last synced {secondsSinceUpdate}s ago
          </Typography>
        )}
      </Paper>

      {/* ── Member Status Panel ── */}
      <Paper
        elevation={0}
        sx={{
          mb: 3,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        {/* Panel header */}
        <Box
          px={{ xs: 2, sm: 3 }}
          py={2}
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
          gap={2}
          sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}
        >
          <Box display="flex" alignItems="center" gap={1}>
            <PeopleAltIcon fontSize="small" color="action" />
            <Typography variant="subtitle1" fontWeight="bold">
              Member Status
            </Typography>
          </Box>
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <TextField
              size="small"
              placeholder="Search members…"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" sx={{ color: 'text.disabled' }} />
                  </InputAdornment>
                ),
              }}
              sx={{ width: { xs: '100%', sm: 200 } }}
            />
            <Button
              variant="contained"
              size="small"
              startIcon={
                sendingBulk ? (
                  <CircularProgress size={14} color="inherit" />
                ) : (
                  <SendIcon fontSize="small" />
                )
              }
              onClick={handleSendBulkReminders}
              disabled={sendingBulk || nonResponderCount === 0}
            >
              {sendingBulk ? 'Sending…' : `Remind All (${nonResponderCount})`}
            </Button>
          </Box>
        </Box>

        {/* Table */}
        <TableContainer sx={{ maxHeight: 520 }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ bgcolor: 'grey.50', fontWeight: 'bold', width: 44 }}>#</TableCell>
                <TableCell sx={{ bgcolor: 'grey.50', fontWeight: 'bold' }}>Email</TableCell>
                <TableCell sx={{ bgcolor: 'grey.50', fontWeight: 'bold', display: { xs: 'none', sm: 'table-cell' } }}>
                  Submitted
                </TableCell>
                <TableCell sx={{ bgcolor: 'grey.50', fontWeight: 'bold' }} align="center">
                  Status
                </TableCell>
                <TableCell sx={{ bgcolor: 'grey.50', fontWeight: 'bold' }} align="center">
                  Action
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredMembers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                    {memberStatus.length === 0
                      ? 'No members in this group.'
                      : `No members match "${memberSearch}"`}
                  </TableCell>
                </TableRow>
              ) : (
                filteredMembers.map((member, index) => (
                  <TableRow key={index} hover>
                    <TableCell>
                      <Typography variant="body2" color="text.disabled">
                        {index + 1}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box display="flex" alignItems="center" gap={1.5}>
                        <Avatar
                          sx={{
                            width: 28,
                            height: 28,
                            bgcolor: member.status === 'responded' ? 'success.50' : 'grey.100',
                            color: member.status === 'responded' ? 'success.main' : 'text.disabled',
                            fontSize: '0.7rem',
                            fontWeight: 'bold',
                            flexShrink: 0,
                          }}
                        >
                          {member.email[0].toUpperCase()}
                        </Avatar>
                        <Typography variant="body2" fontWeight="medium">
                          {member.email}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                      <Typography variant="body2" color="text.secondary">
                        {member.submitted_at
                          ? new Date(member.submitted_at).toLocaleString()
                          : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      {member.status === 'responded' ? (
                        <Chip
                          icon={<CheckCircleIcon />}
                          label="Responded"
                          color="success"
                          size="small"
                          variant="outlined"
                        />
                      ) : (
                        <Chip
                          icon={<CancelIcon />}
                          label="Waiting"
                          color="error"
                          size="small"
                          variant="outlined"
                        />
                      )}
                    </TableCell>
                    <TableCell align="center">
                      {member.status === 'not_responded' && (
                        <Tooltip title="Send individual reminder">
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => handleSendReminder(member.email)}
                            disabled={sendingEmail === member.email}
                          >
                            {sendingEmail === member.email ? (
                              <CircularProgress size={16} />
                            ) : (
                              <EmailIcon fontSize="small" />
                            )}
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* ── Unrecognized Responses ── */}
      {nonMemberResponses.length > 0 && (
        <Paper
          elevation={0}
          sx={{
            border: '1px solid',
            borderColor: 'warning.light',
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <Box
            px={{ xs: 2, sm: 3 }}
            py={2}
            display="flex"
            alignItems="center"
            gap={1}
            sx={{ borderBottom: '1px solid', borderColor: 'warning.light', bgcolor: '#fffbf0' }}
          >
            <WarningAmberIcon color="warning" fontSize="small" />
            <Typography variant="subtitle1" fontWeight="bold" color="warning.dark">
              Unrecognized Responses
            </Typography>
            <Chip
              label={nonMemberResponses.length}
              size="small"
              color="warning"
              variant="outlined"
              sx={{ ml: 0.5 }}
            />
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ bgcolor: '#fffbf0', fontWeight: 'bold' }}>Email</TableCell>
                  <TableCell sx={{ bgcolor: '#fffbf0', fontWeight: 'bold', display: { xs: 'none', sm: 'table-cell' } }}>
                    Submitted
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#fffbf0', fontWeight: 'bold' }} align="center">
                    Add to Group
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {nonMemberResponses.map((response) => (
                  <TableRow key={response.id} hover>
                    <TableCell>
                      <Typography variant="body2">{response.respondent_email || 'Anonymous'}</Typography>
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                      <Typography variant="body2" color="text.secondary">
                        {new Date(response.submitted_at).toLocaleString()}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      {response.respondent_email && (
                        <Tooltip title="Add this email to the group">
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => handleAddEmailToGroup(response.respondent_email)}
                            disabled={addingEmail === response.respondent_email}
                          >
                            {addingEmail === response.respondent_email ? (
                              <CircularProgress size={16} />
                            ) : (
                              <PersonAddIcon fontSize="small" />
                            )}
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* ── Snackbar ── */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
}