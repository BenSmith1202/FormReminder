import { useEffect, useState } from 'react';
import { AppBar, Toolbar, Typography, Button, Box, useMediaQuery, useTheme } from '@mui/material';
import { useNavigate, Outlet, useLocation } from 'react-router-dom';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import AddIcon from '@mui/icons-material/Add';
import EmailIcon from '@mui/icons-material/Email';
import GroupIcon from '@mui/icons-material/Group';
import SettingsIcon from '@mui/icons-material/Settings';
import BarChartIcon from '@mui/icons-material/BarChart';
import LogoutIcon from '@mui/icons-material/Logout';

const API_URL = 'http://localhost:5000';

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
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

          {/* User greeting - hide on small screens to save space */}
          {user && !isMobile && (
            <Typography variant="body2" sx={{ mr: 2 }}>
              Welcome, {user.username}
            </Typography>
          )}

          {/* Navigation Links - icon-only on mobile so they fit */}
          <Box sx={{ display: 'flex', gap: { xs: 0.5, md: 1 }, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Button
              color="inherit"
              startIcon={<AddIcon />}
              onClick={() => navigate('/requests/new')}
              variant={location.pathname === '/requests/new' ? 'outlined' : 'text'}
              size={isMobile ? 'small' : 'medium'}
              aria-label="New Request"
              sx={isMobile ? { minWidth: 40 } : {}}
            >
              {!isMobile && 'New Request'}
            </Button>
            <Button
              color="inherit"
              startIcon={<EmailIcon />}
              onClick={() => navigate('/')}
              variant={location.pathname === '/' ? 'outlined' : 'text'}
              size={isMobile ? 'small' : 'medium'}
              aria-label="Form Requests"
              sx={isMobile ? { minWidth: 40 } : {}}
            >
              {!isMobile && 'Form Requests'}
            </Button>
            <Button
              color="inherit"
              startIcon={<GroupIcon />}
              onClick={() => navigate('/groups')}
              variant={location.pathname.startsWith('/groups') ? 'outlined' : 'text'}
              size={isMobile ? 'small' : 'medium'}
              aria-label="Groups"
              sx={isMobile ? { minWidth: 40 } : {}}
            >
              {!isMobile && 'Groups'}
            </Button>
            <Button
              color="inherit"
              startIcon={<BarChartIcon />}
              onClick={() => navigate('/analytics')}
              variant={location.pathname === '/analytics' ? 'outlined' : 'text'}
              size={isMobile ? 'small' : 'medium'}
              aria-label="Analytics"
              sx={isMobile ? { minWidth: 40 } : {}}
            >
              {!isMobile && 'Analytics'}
            </Button>
            <Button
              color="inherit"
              startIcon={<SettingsIcon />}
              onClick={() => {
                // TODO: Navigate to settings page when created
                alert('Settings page coming soon');
              }}
              size={isMobile ? 'small' : 'medium'}
              aria-label="Settings"
              sx={isMobile ? { minWidth: 40 } : {}}
            >
              {!isMobile && 'Settings'}
            </Button>
            <Button
              color="inherit"
              onClick={handleLogout}
              startIcon={isMobile ? <LogoutIcon /> : undefined}
              size={isMobile ? 'small' : 'medium'}
              aria-label="Log out"
              sx={{ ml: isMobile ? 0.5 : 1, ...(isMobile ? { minWidth: 40 } : {}) }}
            >
              {!isMobile && 'Log Out'}
            </Button>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Main Page Content - Use Outlet for nested routes */}
      <Box component="main" sx={{ flexGrow: 1, bgcolor: 'background.default' }}>
        <Outlet />
      </Box>
    </Box>
  );
}