import { useState, useEffect } from 'react';
import { Paper, Typography, TextField, Button, Box, Alert, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, Select, FormControl, InputLabel, ToggleButton, ToggleButtonGroup, Divider } from '@mui/material';
import { useNavigate } from 'react-router-dom';

const API_URL = 'http://localhost:5000';

// Schedule presets
const SCHEDULE_PRESETS = {
  quick: { label: 'Quick (Every 2 days)', days: 2 },
  medium: { label: 'Medium (Every 4 days)', days: 4 },
  relaxed: { label: 'Relaxed (Weekly)', days: 7 },
};

interface Group {
  id: string;
  name: string;
  member_count: number;
}

// Helper to format date for input
const formatDateForInput = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

export default function CreateRequest() {
  const navigate = useNavigate();
  const [formUrl, setFormUrl] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [needsGoogleAuth, setNeedsGoogleAuth] = useState(false);
  
  // Schedule state
  const [schedulePreset, setSchedulePreset] = useState<'quick' | 'medium' | 'relaxed'>('medium');
  const [endDate, setEndDate] = useState<string>(() => {
    const defaultEnd = new Date();
    defaultEnd.setDate(defaultEnd.getDate() + 30);
    return formatDateForInput(defaultEnd);
  });

  // Check Google auth status and load groups on mount
  useEffect(() => {
    const init = async () => {
      await checkGoogleAuth();
      await loadGroups();
    };
    init();
  }, []);

  const loadGroups = async () => {
    try {
      const response = await fetch(`${API_URL}/api/groups`, {
        credentials: 'include',
      });
      const data = await response.json();
      console.log('Loaded groups:', data);
      setGroups(data.groups || []);
    } catch (error) {
      console.error('Failed to load groups:', error);
    }
  };

  const checkGoogleAuth = async () => {
    try {
      const response = await fetch(`${API_URL}/api/google-auth-status`, {
        credentials: 'include',
      });
      const data = await response.json();
      
      console.log('Google auth status:', data);
      
      if (!data.google_connected) {
        setNeedsGoogleAuth(true);
      }
    } catch (error) {
      console.error('Failed to check Google auth:', error);
      setError('Failed to check Google connection status');
    } finally {
      setCheckingAuth(false);
    }
  };

  const handleConnectGoogle = async () => {
    try {
      console.log('Initiating Google OAuth...');
      const response = await fetch(`${API_URL}/login/google`, {
        credentials: 'include',
      });
      const data = await response.json();
      
      if (data.authorization_url) {
        console.log('Redirecting to Google authorization:', data.authorization_url);
        // Redirect to Google's authorization page
        window.location.href = data.authorization_url;
      } else {
        setError('Failed to get Google authorization URL');
      }
    } catch (error) {
      console.error('Failed to initiate Google OAuth:', error);
      setError('Failed to connect Google account');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!groupId) {
      setError('Please select a group');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const intervalDays = SCHEDULE_PRESETS[schedulePreset].days;
      const endDateISO = new Date(endDate + 'T23:59:59Z').toISOString();
      
      console.log('Creating form request for URL:', formUrl, 'with group:', groupId);
      console.log('Schedule:', intervalDays, 'days, ends:', endDateISO);
      
      const response = await fetch(`${API_URL}/api/form-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          form_url: formUrl,
          group_id: groupId,
          schedule_interval_days: intervalDays,
          schedule_end_date: endDateISO
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        // Check if credentials were revoked - automatically reconnect
        if (data.action_required === 'reconnect_google') {
          console.log('Credentials revoked, automatically redirecting to Google OAuth...');
          // Trigger OAuth flow automatically
          const oauthResponse = await fetch(`${API_URL}/login/google`, {
            credentials: 'include',
          });
          const oauthData = await oauthResponse.json();
          
          if (oauthData.authorization_url) {
            // Redirect to Google's authorization page
            window.location.href = oauthData.authorization_url;
            return; // Don't throw error, user is being redirected
          }
        }
        throw new Error(data.error || data.message || 'Failed to create form request');
      }
      
      console.log('✅ Form request created:', data);
      // Navigate to dashboard after successful creation
      navigate('/');
      
    } catch (err: any) {
      console.error('❌ Failed to create form request:', err);
      setError(err.message || 'Failed to create form request. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    navigate('/');
  };

  if (checkingAuth) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box maxWidth="sm" sx={{ mx: 'auto' }}>
      {/* Google Auth Required Dialog */}
      <Dialog open={needsGoogleAuth} onClose={() => {}}>
        <DialogTitle>Connect Your Google Account</DialogTitle>
        <DialogContent>
          <Typography>
            To create form requests and track responses, you need to connect your Google account.
            This allows us to access your Google Forms data.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancel} color="inherit">
            Cancel
          </Button>
          <Button onClick={handleConnectGoogle} variant="contained" color="primary">
            Connect Google Account
          </Button>
        </DialogActions>
      </Dialog>

      <Paper sx={{ p: 4 }}>
        <Typography variant="h5" gutterBottom>
          Create a New Form Request
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Paste the link to your Google Form below. We will automatically track responses and fetch the latest data.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <FormControl fullWidth sx={{ mb: 2 }} required>
            <InputLabel>Select Group</InputLabel>
            <Select
              value={groupId}
              label="Select Group"
              onChange={(e) => setGroupId(e.target.value)}
            >
              {groups.length === 0 ? (
                <MenuItem disabled>No groups available</MenuItem>
              ) : (
                groups.map((group) => (
                  <MenuItem key={group.id} value={group.id}>
                    {group.name} ({group.member_count} members)
                  </MenuItem>
                ))
              )}
            </Select>
          </FormControl>
          
          <TextField
            fullWidth
            label="Google Form URL"
            placeholder="https://docs.google.com/forms/d/..."
            variant="outlined"
            margin="normal"
            value={formUrl}
            onChange={(e) => setFormUrl(e.target.value)}
            required
            disabled={loading}
            helperText="Example: https://docs.google.com/forms/d/1a2b3c4d5e6f7g8h9/edit"
          />
          
          <Divider sx={{ my: 3 }} />
          
          <Typography variant="h6" gutterBottom>
            Reminder Schedule
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            First reminder is sent immediately. Choose how often to send follow-up reminders.
          </Typography>
          
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" gutterBottom>
              Reminder Frequency
            </Typography>
            <ToggleButtonGroup
              value={schedulePreset}
              exclusive
              onChange={(_, value) => value && setSchedulePreset(value)}
              fullWidth
              disabled={loading}
            >
              <ToggleButton value="quick" color="primary">
                Quick<br />(Every 2 days)
              </ToggleButton>
              <ToggleButton value="medium" color="primary">
                Medium<br />(Every 4 days)
              </ToggleButton>
              <ToggleButton value="relaxed" color="primary">
                Relaxed<br />(Weekly)
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
          
          <TextField
            fullWidth
            label="Stop Reminders After"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            disabled={loading}
            InputLabelProps={{ shrink: true }}
            helperText="Automatic reminders will stop after this date"
            sx={{ mb: 2 }}
          />
          
          <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
            <Button 
              variant="contained" 
              size="large" 
              type="submit"
              disabled={loading}
              startIcon={loading ? <CircularProgress size={20} /> : null}
            >
              {loading ? 'Creating...' : 'Create Request'}
            </Button>
            <Button 
              variant="text" 
              size="large"
              onClick={handleCancel}
              disabled={loading}
            >
              Cancel
            </Button>
          </Box>
        </form>
      </Paper>
    </Box>
  );
}