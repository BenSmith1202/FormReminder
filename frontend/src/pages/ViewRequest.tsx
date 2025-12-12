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
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';

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

  const loadFormRequestData = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_URL}/api/form-requests/${requestId}/responses`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed to load form request: ${response.status}`);
      }

      const data = await response.json();
      
      console.log('Loaded form request data:', data);
      
      setFormRequest(data.form_request);
      setNonMemberResponses(data.non_member_responses || []);
      setMemberStatus(data.member_status || []);
      setLastUpdated(new Date());
    } catch (err: any) {
      console.error('Error loading form request:', err);
      console.error('Auto-refresh error:', err);
      setError(err.message || 'Failed to load form request');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (requestId) {
      loadFormRequestData();
    }
  }, [requestId]);

  // Auto-refresh polling
  useEffect(() => {
    if (!requestId) return;

    // Poll every 30 seconds
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        syncAndLoadData();
      }
    }, 30000);

    // Handle tab visibility changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Immediately refresh when tab becomes active
        syncAndLoadData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup
    return () => {
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [requestId]);

  const syncAndLoadData = async () => {
    try {
      // Sync with Google Forms first
      const response = await fetch(`${API_URL}/api/form-requests/${requestId}/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      
      if (!response.ok) {
        const result = await response.json();
        console.error('Auto-refresh sync error:', result.error);
      }
      
      // Then load the updated data
      await loadFormRequestData();
    } catch (error) {
      console.error('Auto-refresh error:', error);
      // Still try to load cached data
      loadFormRequestData();
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

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error && !formRequest) {
    return (
      <Box>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/')}
          sx={{ mb: 2 }}
        >
          Back to Dashboard
        </Button>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!formRequest) {
    return (
      <Box>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/')}
          sx={{ mb: 2 }}
        >
          Back to Dashboard
        </Button>
        <Alert severity="warning">Form request not found</Alert>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box display="flex" alignItems="center" mb={3}>
        <IconButton onClick={() => navigate('/')} sx={{ mr: 2 }}>
          <ArrowBackIcon />
        </IconButton>
        <Box>
          <Typography variant="h4">
            {formRequest.title}
          </Typography>
          {lastUpdated && (
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
              Last updated: {secondsSinceUpdate}s ago
            </Typography>
          )}
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Warnings */}
      {formRequest.warnings && formRequest.warnings.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {formRequest.warnings.join(', ')}
        </Alert>
      )}

      {/* Form Details */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Form Details
        </Typography>
        <Divider sx={{ mb: 2 }} />
        
        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              Description
            </Typography>
            <Typography variant="body1">
              {formRequest.description || 'No description'}
            </Typography>
          </Box>

          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              Form URL
            </Typography>
            <Typography variant="body2">
              <a href={formRequest.form_url} target="_blank" rel="noopener noreferrer">
                {formRequest.form_url}
              </a>
            </Typography>
          </Box>

          <Box display="flex" gap={4}>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Created
              </Typography>
              <Typography variant="body1">
                {new Date(formRequest.created_at).toLocaleString()}
              </Typography>
            </Box>

            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Last Synced
              </Typography>
              <Typography variant="body1">
                {new Date(formRequest.last_synced_at).toLocaleString()}
              </Typography>
            </Box>

            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Status
              </Typography>
              <Chip 
                label={formRequest.status} 
                color={formRequest.status === 'Active' ? 'success' : 'default'}
                size="small"
              />
            </Box>
          </Box>
        </Stack>
      </Paper>

      {/* Response Summary */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Response Summary
        </Typography>
        <Divider sx={{ mb: 2 }} />
        
        <Box display="flex" alignItems="center" gap={2}>
          <Typography variant="h3" color="primary">
            {formRequest.response_count}
          </Typography>
          <Typography variant="h5" color="text.secondary">
            / {formRequest.total_recipients || 0}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            responses received
          </Typography>
        </Box>
        
        {nonMemberResponses.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            ⚠️ {nonMemberResponses.length} response{nonMemberResponses.length !== 1 ? 's' : ''} from non-members
          </Alert>
        )}
      </Paper>

      {/* Member Status Table */}
      {memberStatus.length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Member Status ({memberStatus.length})
          </Typography>
          <Divider sx={{ mb: 2 }} />

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell width="50">#</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Submitted At</TableCell>
                  <TableCell width="120" align="center">Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {memberStatus.map((member, index) => (
                  <TableRow key={index} hover>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">
                        {member.email}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {member.submitted_at 
                        ? new Date(member.submitted_at).toLocaleString()
                        : '-'}
                    </TableCell>
                    <TableCell align="center">
                      {member.status === 'responded' ? (
                        <Chip 
                          icon={<CheckCircleIcon />} 
                          label="Responded" 
                          color="success" 
                          size="small" 
                        />
                      ) : (
                        <Chip 
                          icon={<CancelIcon />} 
                          label="Not Responded" 
                          color="error" 
                          size="small" 
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Non-Member Responses */}
      {nonMemberResponses.length > 0 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Non-Member Responses ({nonMemberResponses.length})
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Alert severity="warning" sx={{ mb: 2 }}>
            These responses are from emails not in your recipient group
          </Alert>

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell width="50">#</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Submitted At</TableCell>
                  <TableCell width="120" align="center">Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {nonMemberResponses.map((response, index) => (
                  <TableRow key={response.id} hover>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">
                        {response.respondent_email || 'Anonymous'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {response.submitted_at 
                        ? new Date(response.submitted_at).toLocaleString()
                        : 'Unknown'}
                    </TableCell>
                    <TableCell align="center">
                      <Chip 
                        label="❓ Non-member" 
                        color="warning" 
                        size="small" 
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
}
