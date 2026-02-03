import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Paper,
  Button,
  Typography,
  Box,
  Alert,
  CircularProgress,
  TextField
} from '@mui/material';

const API_URL = 'http://localhost:5000';

export default function Settings() {
    const navigate = useNavigate();
    const [error, setError] = useState('');
    const [user, setUser] = useState<any>(null);
    const [newUsername, setNewUsername] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check if user is logged in
        const checkAuth = async () => {
          try {
            const response = await fetch(`${API_URL}/api/current-user`, {
              credentials: 'include',
            });
            const data = await response.json();
            
            if (data.authenticated) {
              setUser(data.user);
            } else {
              // Redirect to login if not authenticated
              navigate('/login');
            }
          } catch (error) {
            console.error('Auth check failed:', error);
            navigate('/login');
          } finally {
            setLoading(false);
          }
        };
    
        checkAuth();
    }, [navigate]);
    
    const handleDelete = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await fetch(`${API_URL}/api/delete`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({ user })
            });
            localStorage.removeItem('user');
            navigate('/login');
        } catch (error) {
            console.error('Account deletion failed:', error);
            setError('Deletion failed');
        }
    };

    const editUsername = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
        await fetch(`${API_URL}/api/edit_username`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({ user, newUsername })
        });
      } catch (error) {
        console.error('Changing username failed:', error)
        setError('Username changing failed')
      }
    }
    
    return (
      
    <Container maxWidth="sm">
      <Box sx={{ mt: 8 }}>
        <Paper elevation={3} sx={{ p: 4 }}>
          <Typography variant="h4" component="h1" gutterBottom align="center">
            Change Username
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <form onSubmit={editUsername}>

            <TextField
                          fullWidth
                          label="New username"
                          variant="outlined"
                          margin="normal"
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
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
              {loading ? <CircularProgress size={24} /> : 'Edit Username'}
            </Button>
          </form>
        </Paper>
      </Box>

      <Box sx={{ mt: 8 }}>
        <Paper elevation={3} sx={{ p: 4 }}>
          <Typography variant="h4" component="h1" gutterBottom align="center">
            Delete Account
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <form onSubmit={handleDelete}>

            <Button
              type="submit"
              fullWidth
              variant="contained"
              color="primary"
              size="large"
              sx={{ mt: 3, mb: 2 }}
              disabled={loading}
            >
              {loading ? <CircularProgress size={24} /> : 'Delete Account'}
            </Button>
          </form>
        </Paper>
      </Box>
    </Container>
  );
}