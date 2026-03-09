import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Box,
  Alert,
  CircularProgress,
} from '@mui/material';
import API_URL from '../config';

function Reset() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setLoading(true);

  try {
    const response = await fetch(`${API_URL}/api/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await response.json();

    if (response.ok) {
      setMessage('If an account exists, a reset link has been sent.');
    } else {
      setError(data.error || 'Reset failed');
    }
  } catch (err) {
    setError('Server connection failed');
  } finally {
    setLoading(false);
  }
};

  return (
    <Container maxWidth="sm">
      <Box sx={{ mt: 8 }}>
        <Paper elevation={3} sx={{ p: 4 }}>
          <Typography variant="h4" component="h1" gutterBottom align="center">
            Reset Password
          </Typography>

          <Typography variant="body2" color="textSecondary" align="center" sx={{ mb: 3 }}>
            Enter your email address and we'll send you a link to reset your password.
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="Email Address"
              type="email"
              variant="outlined"
              margin="normal"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />

            <Button
              type="submit"
              fullWidth
              variant="contained"
              color="primary"
              size="large"
              sx={{ mt: 3, mb: 2 }}
              disabled={loading}
            >
              {loading ? <CircularProgress size={24} /> : 'Send Reset Link'}
            </Button>
            
            <Button 
              fullWidth 
              variant="text" 
              onClick={() => navigate('/login')}
            >
              Back to Login
            </Button>
          </form>
        </Paper>
      </Box>
    </Container>
  );
}

export default Reset;