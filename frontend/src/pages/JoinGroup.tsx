import { useState, useEffect } from 'react';
import { Paper, Typography, TextField, Button, Box, Alert, CircularProgress } from '@mui/material';
import { useParams } from 'react-router-dom';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import API_URL from '../config';
import AnimatedInfoButton from '../components/InfoButton';

export default function JoinGroup() {
  const { token } = useParams<{ token: string }>();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupInfo, setGroupInfo] = useState<any>(null);
  const [success, setSuccess] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);

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
      const payload = needsVerification 
        ? { email, code: verificationCode } 
        : { email };

      const response = await fetch(`${API_URL}/api/groups/join/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      });
      
      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error || 'Failed to join group');

      if (data.needs_verification) {
        setNeedsVerification(true);
      } else {
        setSuccess(true);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <Typography variant="h5" component="h1" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>
          Join Group
        </Typography>
        <CircularProgress />
      </Box>
    );
  }

  if (success) {
    return (
      <Box maxWidth="sm" sx={{ mx: 'auto', mt: 8 }}>
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
          <Typography variant="h5" component="h1" gutterBottom>
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
        <Typography variant="h5" component="h1" gutterBottom>
          Join Group        <AnimatedInfoButton title="Joining a FormReminder Group">
                              <p>FormReminder is a platform for managing form responses. Click "Join Group" to become a member of the group that you were invited to.</p>
                              <p>Once you join, you'll be able to receive form requests sent to this group and submit your responses.</p>
                              <p>You will also receive reminders about upcoming form requests.</p>
                              <p>If you have any questions or issues, please contact the person who shared the invite link with you.</p>
                            </AnimatedInfoButton>
        </Typography>
        
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {groupInfo && (
          <>
            <Box sx={{ mb: 3, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
              <Typography variant="h6" component="h2" gutterBottom>
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
              disabled={needsVerification} // Lock email while verifying code
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              sx={{ mb: 3 }}
            />

            {needsVerification && (
              <TextField
                label="Verification Code"
                fullWidth
                required
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                sx={{ mb: 3 }}
                placeholder="123456"
                helperText="Enter the 6-digit code sent to your email"
              />
            )}

            <Button
              type="submit"
              variant="contained"
              disabled={submitting || !email.trim() || (needsVerification && !verificationCode.trim())}
              fullWidth
              size="large"
            >
              {submitting ? 'Processing...' : needsVerification ? 'Verify & Join' : 'Send Code'}
            </Button>
            
            {needsVerification && (
              <Button 
                variant="text" 
                onClick={() => setNeedsVerification(false)} 
                sx={{ mt: 1 }}
              >
                Change Email
              </Button>
            )}
          </form>
          </>
        )}
      </Paper>
    </Box>
  );
}
