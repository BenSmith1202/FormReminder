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
  Stack,
  Divider,
  IconButton,
  Grid,
  Link,
  Tooltip,
  Snackbar
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

import API_URL from '../config';

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
  // Handle both string (legacy) and object (new) formats
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
  const [addingEmail, setAddingEmail] = useState<string | null>(null);  // Track which email is being added
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>(
    { open: false, message: '', severity: 'success' }
  );

  const loadFormRequestData = async () => {
    try {
      // Only show full spinner on first load
      if (!formRequest) setLoading(true);
      setError(null);

      const response = await fetch(`${API_URL}/api/form-requests/${requestId}/responses`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed to load form request: ${response.status}`);
      }

      const data = await response.json();
      
      setFormRequest(data.form_request);
      setNonMemberResponses(data.non_member_responses || []);
      setMemberStatus(data.member_status || []);
      setLastUpdated(new Date());
    } catch (err: any) {
      console.error('Error loading form request:', err);
      setError(err.message || 'Failed to load form request');
    } finally {
      setLoading(false);
    }
  };

  const handleSendReminder = async (email: string) => {
    if (!window.confirm(`Send a reminder email to ${email}?`)) return;

    setSendingEmail(email);
    try {
      const response = await fetch(`${API_URL}/api/form-requests/${requestId}/send-reminder/${encodeURIComponent(email)}`, {
        method: 'POST',
        credentials: 'include',
      });
      
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to send reminder');
      
      alert(result.message || 'Reminder sent successfully!');
    } catch (err: any) {
      alert(`Failed to send reminder: ${err.message}`);
    } finally {
      setSendingEmail(null);
    }
  };

  const handleSendBulkReminders = async () => {
    const nonResponders = memberStatus.filter(m => m.status === 'not_responded');
    if (nonResponders.length === 0) {
      alert('All members have already responded!');
      return;
    }

    if (!window.confirm(`Send reminder emails to all ${nonResponders.length} non-responders?`)) return;

    setSendingBulk(true);
    try {
      const response = await fetch(`${API_URL}/api/form-requests/${requestId}/send-reminders`, {
        method: 'POST',
        credentials: 'include',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to send reminders');
      
      alert(`Success!\n\nSent: ${result.sent}\nSkipped: ${result.skipped}\nFailed: ${result.failed}`);
    } catch (err: any) {
      alert(`Failed to send reminders: ${err.message}`);
    } finally {
      setSendingBulk(false);
    }
  };

  // Add unrecognized email to the form's group
  const handleAddEmailToGroup = async (email: string) => {
    setAddingEmail(email);
    try {
      const response = await fetch(`${API_URL}/api/form-requests/${requestId}/add-email-to-group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email })
      });
      
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to add email');
      
      setSnackbar({ open: true, message: result.message, severity: 'success' });
      
      // Reload data to reflect the change
      loadFormRequestData();
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setAddingEmail(null);
    }
  };

  useEffect(() => {
    if (requestId) loadFormRequestData();
  }, [requestId]);

  // Auto-refresh polling
  useEffect(() => {
    if (!requestId) return;
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        // Sync silently (no loading spinner)
        fetch(`${API_URL}/api/form-requests/${requestId}/refresh`, {
            method: 'POST',
            credentials: 'include',
        }).then(() => loadFormRequestData()).catch(console.error);
      }
    }, 30000);
    return () => clearInterval(pollInterval);
  }, [requestId]);

  // Update "seconds since update" counter
  useEffect(() => {
    if (!lastUpdated) return;
    const timer = setInterval(() => {
      setSecondsSinceUpdate(Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [lastUpdated]);

  const getScheduleLabel = (schedule?: string | { schedule_type: string; [key: string]: any }) => {
    // Extract string type if it's an object
    const type = (typeof schedule === 'object' && schedule !== null) ? schedule.schedule_type : schedule;

    switch(type) {
      case 'gentle': return 'Gentle (3, 1 days before)';
      case 'normal': return 'Normal (5, 3, 1 days before)';
      case 'frequent': return 'Frequent (Daily last week)';
      case 'custom': return 'Custom Schedule';
      default: return type || 'Not set';
    }
  };

  if (loading && !formRequest) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error || !formRequest) {
    return (
      <Box p={3}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/')} sx={{ mb: 2 }}>
          Back to Dashboard
        </Button>
        <Alert severity="error">{error || 'Form request not found'}</Alert>
      </Box>
    );
  }

  return (
    <Box maxWidth="xl" sx={{ mx: 'auto', px: 2, py: 3 }}>
      {/* Header */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Box display="flex" alignItems="center">
          <IconButton onClick={() => navigate('/')} sx={{ mr: 2 }}>
            <ArrowBackIcon />
          </IconButton>
          <Box>
            <Typography variant="h4" fontWeight="bold">
              {formRequest.title}
            </Typography>
            {lastUpdated && (
              <Typography variant="caption" color="text.secondary">
                Last updated: {secondsSinceUpdate}s ago
              </Typography>
            )}
          </Box>
        </Box>
        <Button
          variant="outlined"
          startIcon={<EditIcon />}
          onClick={() => navigate(`/requests/${requestId}/edit`)}
        >
          Edit Configuration
        </Button>
      </Box>

      {formRequest.warnings && formRequest.warnings.length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {formRequest.warnings.join(', ')}
        </Alert>
      )}

      <Grid container spacing={3} mb={3}>
        {/* Main Info */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" gutterBottom>Request Details</Typography>
            <Divider sx={{ mb: 2 }} />
            
            <Stack spacing={2}>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Description</Typography>
                <Typography variant="body1">{formRequest.description || 'No description provided.'}</Typography>
              </Box>

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <EventIcon color="action" fontSize="small" />
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary">Due Date</Typography>
                      <Typography variant="body1">
                        {formRequest.due_date ? new Date(formRequest.due_date).toLocaleDateString() : 'Not set'}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <ScheduleIcon color="action" fontSize="small" />
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary">Schedule</Typography>
                      <Typography variant="body1">
                        {getScheduleLabel(formRequest.reminder_schedule)}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
              </Grid>

              <Box>
                <Typography variant="subtitle2" color="text.secondary">Form URL</Typography>
                <Link href={formRequest.form_url} target="_blank" rel="noopener" underline="hover" sx={{ wordBreak: 'break-all' }}>
                  {formRequest.form_url}
                </Link>
              </Box>

              <Box display="flex" gap={2}>
                 <Chip label={formRequest.status} color={formRequest.status === 'Active' ? 'success' : 'default'} size="small" />
                 <Typography variant="body2" color="text.secondary">
                    Created: {new Date(formRequest.created_at).toLocaleDateString()}
                 </Typography>
              </Box>
            </Stack>
          </Paper>
        </Grid>

        {/* Stats */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 3, textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography variant="h6" color="text.secondary" gutterBottom>Response Rate</Typography>
            <Box position="relative" display="inline-flex" justifyContent="center" my={2}>
              <CircularProgress 
                variant="determinate" 
                value={formRequest.total_recipients > 0 ? (formRequest.response_count / formRequest.total_recipients) * 100 : 0} 
                size={80}
                thickness={4}
              />
              <Box position="absolute" top={0} left={0} bottom={0} right={0} display="flex" alignItems="center" justifyContent="center">
                <Typography variant="h6" color="text.secondary">
                  {formRequest.total_recipients > 0 ? Math.round((formRequest.response_count / formRequest.total_recipients) * 100) : 0}%
                </Typography>
              </Box>
            </Box>
            <Typography variant="h4">
              {formRequest.response_count} <Typography component="span" variant="h6" color="text.secondary">/ {formRequest.total_recipients}</Typography>
            </Typography>
            <Typography variant="body2" color="text.secondary">responses received</Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Member Table */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h6">Member Status</Typography>
          <Button
            variant="contained"
            startIcon={sendingBulk ? <CircularProgress size={20} color="inherit" /> : <SendIcon />}
            onClick={handleSendBulkReminders}
            disabled={sendingBulk || memberStatus.filter(m => m.status === 'not_responded').length === 0}
          >
            {sendingBulk ? 'Sending...' : `Remind All Outstanding (${memberStatus.filter(m => m.status === 'not_responded').length})`}
          </Button>
        </Box>
        <Divider sx={{ mb: 2 }} />

        <TableContainer sx={{ maxHeight: 600 }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell width="50">#</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Submitted At</TableCell>
                <TableCell align="center">Status</TableCell>
                <TableCell align="center">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {memberStatus.map((member, index) => (
                <TableRow key={index} hover>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight="medium">{member.email}</Typography>
                  </TableCell>
                  <TableCell>
                    {member.submitted_at ? new Date(member.submitted_at).toLocaleString() : '-'}
                  </TableCell>
                  <TableCell align="center">
                    {member.status === 'responded' ? (
                      <Chip icon={<CheckCircleIcon />} label="Responded" color="success" size="small" />
                    ) : (
                      <Chip icon={<CancelIcon />} label="Waiting" color="error" size="small" variant="outlined" />
                    )}
                  </TableCell>
                  <TableCell align="center">
                    {member.status === 'not_responded' && (
                      <Tooltip title="Send individual reminder">
                        <IconButton 
                          color="primary"
                          onClick={() => handleSendReminder(member.email)}
                          disabled={sendingEmail === member.email}
                        >
                          {sendingEmail === member.email ? <CircularProgress size={20} /> : <EmailIcon />}
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

      {/* Non-Member Responses */}
      {nonMemberResponses.length > 0 && (
        <Paper sx={{ p: 3, bgcolor: '#fff4e5' }}>
          <Typography variant="h6" gutterBottom color="warning.dark">
            ⚠️ Unrecognized Responses ({nonMemberResponses.length})
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Email</TableCell>
                  <TableCell>Submitted At</TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {nonMemberResponses.map((response) => (
                  <TableRow key={response.id}>
                    <TableCell>{response.respondent_email || 'Anonymous'}</TableCell>
                    <TableCell>{new Date(response.submitted_at).toLocaleString()}</TableCell>
                    <TableCell align="center">
                      {/* Add email to group button - only show if email exists */}
                      {response.respondent_email && (
                        <Tooltip title="Add this email to the group">
                          <IconButton
                            color="primary"
                            onClick={() => handleAddEmailToGroup(response.respondent_email)}
                            disabled={addingEmail === response.respondent_email}
                          >
                            {addingEmail === response.respondent_email ? (
                              <CircularProgress size={20} />
                            ) : (
                              <PersonAddIcon />
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

      {/* Snackbar for feedback messages */}
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
    </Box>
  );
}