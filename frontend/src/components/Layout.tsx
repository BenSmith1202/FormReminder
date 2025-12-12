import React, { useEffect, useState } from 'react';
import { AppBar, Toolbar, Typography, Button, Container, Box } from '@mui/material';
import { useNavigate, Outlet } from 'react-router-dom';
import CheckBoxIcon from '@mui/icons-material/CheckBox';

const API_URL = 'http://localhost:5000';

// This matches your report's "Top Bar Navigation" requirement
export default function Layout() {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
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

  const handleLogout = async () => {
    try {
      await fetch(`${API_URL}/api/logout`, {
        method: 'POST',
        credentials: 'include',
      });
      localStorage.removeItem('user');
      navigate('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" color="default" elevation={1}>
        <Toolbar>
          {/* Logo / Brand */}
          <Box display="flex" alignItems="center" sx={{ flexGrow: 1, cursor: 'pointer' }} onClick={() => navigate('/')}>
            <CheckBoxIcon color="primary" sx={{ mr: 1 }} />
            <Typography variant="h6" color="inherit" noWrap sx={{ fontWeight: 'bold' }}>
              FormReminder
            </Typography>
          </Box>

          {/* User greeting */}
          {user && (
            <Typography variant="body2" sx={{ mr: 2 }}>
              Welcome, {user.username}
            </Typography>
          )}

          {/* Navigation Links */}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button color="inherit" onClick={() => navigate('/')}>Dashboard</Button>
            <Button color="inherit" onClick={() => navigate('/groups')}>Groups</Button>
            <Button color="inherit" onClick={() => navigate('/time')}>Server Time</Button>
            <Button color="inherit" onClick={handleLogout}>Logout</Button>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Main Page Content - Use Outlet for nested routes */}
      <Container component="main" maxWidth="lg" sx={{ mt: 4, mb: 4, flexGrow: 1 }}>
        <Outlet />
      </Container>
    </Box>
  );
}