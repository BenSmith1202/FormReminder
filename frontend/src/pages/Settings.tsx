import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Card,
  CardHeader,
  CardContent,
  CardActions,
  Button,
  Typography,
  Box,
  Alert,
  CircularProgress,
  TextField,
  Divider
} from '@mui/material';

const API_URL = 'http://localhost:5000';

export default function Settings() {
    const navigate = useNavigate();
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [user, setUser] = useState<any>(null);
    const [newUsername, setNewUsername] = useState('');
    const [deletePassword, setDeletePassword] = useState('');
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);

    useEffect(() => {
        const checkAuth = async () => {
          try {
            const response = await fetch(`${API_URL}/api/current-user`, {
              credentials: 'include',
            });
            const data = await response.json();
            
            if (data.authenticated) {
              setUser(data.user);
            } else {
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
        setError('');
        setActionLoading(true);
        try {
            const response = await fetch(`${API_URL}/api/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ user, password: deletePassword })
            });
            
            const data = await response.json();
            if (response.ok) {
                localStorage.removeItem('user');
                navigate('/login');
            } else {
                setError(data.error || 'Deletion failed. Check your password.');
            }
        } catch (error) {
            setError('Connection failed. Please try again.');
        } finally {
            setActionLoading(false);
        }
    };

    const editUsername = async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');
      setSuccess('');
      setActionLoading(true);
      try {
        const response = await fetch(`${API_URL}/api/edit_username`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ user, newUsername })
        });
        if (response.ok) {
            setSuccess('Username updated successfully!');
            setNewUsername('');
        } else {
            setError('Failed to update username.');
        }
      } catch (error) {
        setError('Connection failed.');
      } finally {
        setActionLoading(false);
      }
    };
    
    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
                <CircularProgress />
            </Box>
        );
    }

    return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom align="center" sx={{ mb: 4, fontWeight: 'bold' }}>
        Account Settings
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 3 }}>{success}</Alert>}

      {/* Security Card */}
      <Card variant="outlined" sx={{ mb: 3, borderRadius: 2 }}>
        <CardHeader 
            title="Security Settings" 
            subheader="WIP"
        />
        <Divider />
      </Card>

      {/* Team Members Card */}
      <Card variant="outlined" sx={{ mb: 3, borderRadius: 2 }}>
        <CardHeader 
            title="Team Members and Organization" 
            subheader="WIP"
        />
        <Divider />
      </Card>

      {/* Notifications Card */}
      <Card variant="outlined" sx={{ mb: 3, borderRadius: 2 }}>
        <CardHeader 
            title="Forms and Notifications" 
            subheader="WIP"
        />
        <Divider />
      </Card>

      {/* Change Username Card */}
      <Card variant="outlined" sx={{ mb: 3, borderRadius: 2 }}>
        <CardHeader 
            title="Profile Information" 
            subheader="Update your public display name"
        />
        <Divider />
        <form onSubmit={editUsername}>
          <CardContent>
            <TextField
              fullWidth
              label="New Username"
              variant="outlined"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              required
            />
          </CardContent>
          <CardActions sx={{ px: 2, pb: 2 }}>
            <Button
              type="submit"
              variant="contained"
              disabled={actionLoading || !newUsername}
              fullWidth
            >
              {actionLoading ? <CircularProgress size={24} /> : 'Save Changes'}
            </Button>
          </CardActions>
        </form>
      </Card>

      {/* Delete Account Card */}
      <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'error.light' }}>
        <CardHeader 
            title={<Typography color="error">Danger Zone</Typography>}
            subheader="Deleting your account is permanent"
        />
        <Divider />
        <form onSubmit={handleDelete}>
          <CardContent>
            <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
              Please enter your password to confirm account deletion.
            </Typography>
            <TextField
              fullWidth
              label="Current Password"
              type="password"
              variant="outlined"
              color="error"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              required
            />
          </CardContent>
          <CardActions sx={{ px: 2, pb: 2 }}>
            <Button
              type="submit"
              variant="contained"
              color="error"
              disabled={actionLoading || !deletePassword}
              fullWidth
            >
              {actionLoading ? <CircularProgress size={24} /> : 'Permanently Delete Account'}
            </Button>
          </CardActions>
        </form>
      </Card>
    </Container>
  );
}