import { useState, useEffect } from 'react';
import { Paper, Typography, TextField, Button, Box, Alert, CircularProgress } from '@mui/material';
import { useParams } from 'react-router-dom';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import API_URL from '../config';

export default function JoinGroup() {
  const { token } = useParams<{ token: string }>();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupInfo, setGroupInfo] = useState<any>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadGroupInfo();
  }, [token]);

  const loadGroupInfo = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/groups/join/${token}`);
      
      if (!response.ok) {
        throw new Error('Invalid or expired invite link');
      }
      
      const data = await response.json();
      console.log('Group info:', data);
      setGroupInfo(data.group);
    } catch (err: any) {
      console.error('Error loading group:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    
    try {
      console.log('Joining group with email:', email);
      
      const response = await fetch(`${API_URL}/api/groups/join/${token}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to join group');
      }
      
      console.log('✅ Successfully joined group:', data);
      setSuccess(true);
      
    } catch (err: any) {
      console.error('❌ Failed to join group:', err);
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  if (success) {
    return (
      <Box maxWidth="sm" sx={{ mx: 'auto', mt: 8 }}>
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
          <Typography variant="h5" gutterBottom>
            Successfully Joined!
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            You've been added to <strong>{groupInfo?.name}</strong>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            You can close this page now.
          </Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box maxWidth="sm" sx={{ mx: 'auto', mt: 8 }}>
      <Paper sx={{ p: 4 }}>
        <Typography variant="h5" gutterBottom>
          Join Group
        </Typography>
        
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {groupInfo && (
          <>
            <Box sx={{ mb: 3, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
              <Typography variant="h6" gutterBottom>
                {groupInfo.name}
              </Typography>
              {groupInfo.description && (
                <Typography variant="body2" color="text.secondary">
                  {groupInfo.description}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                {groupInfo.member_count} current member{groupInfo.member_count !== 1 ? 's' : ''}
              </Typography>
            </Box>

            <form onSubmit={handleSubmit}>
              <TextField
                label="Your Email"
                type="email"
                fullWidth
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                sx={{ mb: 3 }}
                placeholder="you@example.com"
              />

              <Button
                type="submit"
                variant="contained"
                disabled={submitting || !email.trim()}
                fullWidth
                size="large"
              >
                {submitting ? 'Joining...' : 'Join Group'}
              </Button>
            </form>
          </>
        )}
      </Paper>
    </Box>
  );
}
