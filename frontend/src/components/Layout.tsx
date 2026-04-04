import { useEffect, useState } from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Box,
  IconButton,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  Tooltip,
} from '@mui/material';
import { useNavigate, Outlet, useLocation } from 'react-router-dom';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import EmailIcon from '@mui/icons-material/Email';
import GroupIcon from '@mui/icons-material/Group';
import SettingsIcon from '@mui/icons-material/Settings';
import BarChartIcon from '@mui/icons-material/BarChart';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import NotificationBell from './NotificationBell';
import './Layout.css';

import API_URL from '../config';

const NAV_ITEMS = [
  { label: 'Form Requests', icon: <EmailIcon fontSize="small" />, path: '/', exact: true },
  { label: 'Groups', icon: <GroupIcon fontSize="small" />, path: '/groups', exact: false },
  { label: 'Analytics', icon: <BarChartIcon fontSize="small" />, path: '/analytics', exact: false },
  { label: 'Settings', icon: <SettingsIcon fontSize="small" />, path: '/settings', exact: false },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isActive = (path: string, exact: boolean) =>
    exact ? location.pathname === path : location.pathname.startsWith(path);

  // Scroll to top on every page navigation
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch(`${API_URL}/api/current-user`, { credentials: 'include' });
        const data = await response.json();
        if (data.authenticated) {
          setUser(data.user);
        } else {
          navigate('/login');
        }
      } catch {
        navigate('/login');
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await fetch(`${API_URL}/api/logout`, { method: 'POST', credentials: 'include' });
      localStorage.removeItem('user');
      navigate('/login');
    } catch {
      console.error('Logout failed');
    }
  };

  const handleNavClick = (path: string) => {
    navigate(path);
    setDrawerOpen(false);
  };

  if (loading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" height="100vh">
        <CheckBoxIcon color="primary" sx={{ fontSize: 32, mr: 1 }} />
        <Typography variant="h6" component="span" fontWeight="bold" color="text.secondary">
          FormReminder
        </Typography>
      </Box>
    );
  }

  // ── Mobile Drawer ─────────────────────────────────────────────────────────
  const drawer = (
    <Box sx={{ width: 280, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Drawer header */}
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        px={2.5}
        py={2}
        sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Box display="flex" alignItems="center" gap={1}>
          <CheckBoxIcon color="primary" />
          <Typography variant="h6" component="span" fontWeight="bold">
            FormReminder
          </Typography>
        </Box>
        <IconButton size="small" onClick={() => setDrawerOpen(false)}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* User info (Mobile) */}
      {user && (
        <Box
          display="flex"
          alignItems="center"
          gap={1.5}
          px={2.5}
          py={2}
          sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}
        >
          <Avatar
            sx={{
              width: 36,
              height: 36,
              bgcolor: 'primary.main',
              color: '#ffffff', // Explicitly setting white text
              fontSize: '0.85rem',
              fontWeight: 'bold',
            }}
          >
            {user.username?.[0]?.toUpperCase()}
          </Avatar>
          <Box>
            <Typography variant="body2" fontWeight="medium">
              {user.username}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Signed in
            </Typography>
          </Box>
        </Box>
      )}

      {/* Nav items */}
      <List sx={{ px: 1, py: 1.5, flexGrow: 1 }}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.path, item.exact);
          return (
            <ListItem key={item.path} disablePadding sx={{ mb: 0.5 }}>
              <ListItemButton
                onClick={() => handleNavClick(item.path)}
                selected={active}
                sx={{
                  borderRadius: 2,
                  '&.Mui-selected': {
                    bgcolor: 'primary.50',
                    color: 'primary.dark',
                    '& .MuiListItemIcon-root': { color: 'primary.dark' },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{ variant: 'body2', fontWeight: active ? 'bold' : 'medium' }}
                />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>

      {/* Logout */}
      <Box px={1} py={1.5} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
        <ListItemButton
          onClick={handleLogout}
          sx={{ borderRadius: 2, color: 'error.main' }}
        >
          <ListItemIcon sx={{ minWidth: 36, color: 'error.main' }}>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Log Out"
            primaryTypographyProps={{ variant: 'body2', fontWeight: 'medium' }}
          />
        </ListItemButton>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="sticky"
        color="default"
        elevation={0}
        sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}
      >
        <Toolbar sx={{ gap: 1 }}>
          {/* Brand */}
          <Box
            display="flex"
            alignItems="center"
            gap={1}
            onClick={() => navigate('/')}
            sx={{ cursor: 'pointer', flexGrow: 1 }}
          >
            <CheckBoxIcon color="primary" sx={{ fontSize: 22 }} />
            <Typography variant="h6" component="span" fontWeight="bold" noWrap>
              FormReminder
            </Typography>
          </Box>

          {/* Desktop nav */}
          <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 0.5 }}>
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.path, item.exact);
              return (
                <Button
                  key={item.path}
                  color="inherit"
                  startIcon={item.icon}
                  onClick={() => navigate(item.path)}
                  sx={{
                    borderRadius: 2,
                    px: 1.5,
                    fontWeight: active ? 'bold' : 'medium',
                    bgcolor: active ? 'primary.50' : 'transparent',
                    color: active ? 'primary.dark' : 'text.primary',
                    '&:hover': { bgcolor: active ? 'primary.100' : 'action.hover' },
                  }}
                >
                  {item.label}
                </Button>
              );
            })}
          </Box>

          {/* Desktop right side (Profile Refined) */}
          <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1, ml: 1 }}>
            {user && (
              <Tooltip title={`Signed in as ${user.username}`} placement="bottom">
                <Avatar
                  sx={{
                    width: 36,
                    height: 36,
                    bgcolor: 'primary.main',
                    color: '#ffffff', // Explicitly setting white text
                    fontSize: '0.85rem',
                    fontWeight: 'bold',
                  }}
                >
                  {user.username?.[0]?.toUpperCase()}
                </Avatar>
              </Tooltip>
            )}
            <NotificationBell />
            <Button
              size="small"
              color="inherit"
              startIcon={<LogoutIcon fontSize="small" />}
              onClick={handleLogout}
              sx={{ color: 'text.secondary', borderRadius: 2 }}
            >
              Log Out
            </Button>
          </Box>

          {/* Mobile right side */}
          <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center', gap: 0.5 }}>
            <NotificationBell />
            <IconButton
              edge="end"
              onClick={() => setDrawerOpen(true)}
              sx={{ color: 'text.primary' }}
            >
              <MenuIcon />
            </IconButton>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Mobile Drawer */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{ sx: { borderRadius: '16px 0 0 16px' } }}
      >
                {drawer}
      </Drawer>

      {/* Page Content */}
      <Box component="main" sx={{ flexGrow: 1, bgcolor: 'background.default' }}>
        <div key={location.pathname} className="page-fade-in">
          <Outlet />
        </div>
      </Box>
    </Box>
  );
}