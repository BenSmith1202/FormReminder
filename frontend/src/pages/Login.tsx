import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Container, Paper, TextField, Button,
  Typography, Box, Alert, CircularProgress,
} from '@mui/material';
import { api } from "../api/client"  // ← replaces the API_URL import

function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Step 1: attempt login
      const loginRes = await api.post('/api/login', { username, password });
      const loginData = await loginRes.json();

      if (!loginRes.ok || !loginData.success) {
        setError(loginData.error || 'Login failed');
        return;
      }

      // Step 2: confirm the session cookie was actually stored
      // before navigating — this eliminates the race condition
      const sessionRes = await api.get('/api/current-user');
      const sessionData = await sessionRes.json();

      if (sessionData.authenticated) {
        // Session is confirmed. No localStorage needed —
        // app should always get user state from /api/current-user
        navigate('/');
      } else {
        // Login succeeded but cookie wasn't stored — almost always
        // a cookie/CORS config issue at this point
        setError('Session could not be established. Please try again.');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };
  return (
    <Container maxWidth="sm" className="page-fade-in">
      <Box sx={{ mt: 8 }}>
        <Paper elevation={3} sx={{ p: 4 }}>
          <Typography variant="h4" component="h1" gutterBottom align="center">
            Login to FormReminder 
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="Username"
              variant="outlined"
              margin="normal"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />

            <TextField
              fullWidth
              label="Password"
              type="password"
              variant="outlined"
              margin="normal"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
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
              {loading ? <CircularProgress size={24} /> : 'Login'}
            </Button>

            <Typography variant="body2" align="center">
              Don't have an account?{' '}
              <Link to="/register" style={{ color: '#1976d2' }}>
                Register here
              </Link>
            </Typography>

            <Typography variant="body2" align="center">
              Forgot your password?{' '}
              <Link to="/reset" style={{ color: '#1976d2' }}>
                Click here to reset
              </Link>
            </Typography>
          </form>
        </Paper>
      </Box>
    </Container>
  );
}

export default Login;
