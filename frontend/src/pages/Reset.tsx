import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container, Paper, TextField, Button, Typography, 
  Box, Alert, CircularProgress
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import API_URL from '../config';

function Reset() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (needsVerification && password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const payload = needsVerification 
        ? { email, code, password } 
        : { email };

      const response = await fetch(`${API_URL}/api/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: "include"
      });

      const data = await response.json();

      if (response.ok) {
        if (data.needs_verification) {
          setNeedsVerification(true);
        } else {
          setSuccess(true);
        }
      } else {
        setError(data.error || 'Action failed');
      }
    } catch (err) {
      setError('Server connection failed');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <Container maxWidth="sm">
        <Box sx={{ mt: 8 }}>
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
            <Typography variant="h5" gutterBottom>Password Reset!</Typography>
            <Typography variant="body1" sx={{ mb: 3 }}>
              Your password has been successfully updated.
            </Typography>
            <Button variant="contained" fullWidth onClick={() => navigate('/login')}>
              Back to Login
            </Button>
          </Paper>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm">
      <Box sx={{ mt: 8 }}>
        <Paper elevation={3} sx={{ p: 4 }}>
          <Typography variant="h4" align="center" gutterBottom>
            {needsVerification ? 'Set New Password' : 'Reset Password'}
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="Email Address"
              type="email"
              margin="normal"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={needsVerification || loading}
              required
            />

            {needsVerification && (
              <>
                <TextField
                  fullWidth
                  label="6-Digit Code"
                  margin="normal"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  required
                  helperText="Enter the code sent to your email"
                />
                <TextField
                  fullWidth
                  label="New Password"
                  type="password"
                  margin="normal"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  inputProps={{ maxLength: 100 }} // Limit name to 50
                />
                <TextField
                  fullWidth
                  label="Confirm New Password"
                  type="password"
                  margin="normal"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </>
            )}

            <Button
              type="submit"
              fullWidth
              variant="contained"
              size="large"
              sx={{ mt: 3, mb: 2 }}
              disabled={loading}
            >
              {loading ? <CircularProgress size={24} /> : (needsVerification ? 'Reset Password' : 'Send Code')}
            </Button>

            {!needsVerification ? (
              <Button fullWidth variant="text" onClick={() => navigate('/login')}>
                Back to Login
              </Button>
            ) : (
              <Button fullWidth variant="text" onClick={() => setNeedsVerification(false)}>
                Change Email
              </Button>
            )}
          </form>
        </Paper>
      </Box>
    </Container>
  );
}

export default Reset;