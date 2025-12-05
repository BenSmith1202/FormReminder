import React from 'react'; // Required for React.ReactNode type
import { AppBar, Toolbar, Typography, Button, Container, Box } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import CheckBoxIcon from '@mui/icons-material/CheckBox';

// This matches your report's "Top Bar Navigation" requirement
export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  return (
    // Outer Box ensures the app takes up the full screen height and width
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* 'sticky' keeps the navbar at the top while you scroll */}
      <AppBar position="sticky" color="default" elevation={1}>
        <Toolbar>
          {/* Logo / Brand */}
          <Box display="flex" alignItems="center" sx={{ flexGrow: 1, cursor: 'pointer' }} onClick={() => navigate('/')}>
            <CheckBoxIcon color="primary" sx={{ mr: 1 }} />
            <Typography variant="h6" color="inherit" noWrap sx={{ fontWeight: 'bold' }}>
              FormReminder
            </Typography>
          </Box>

          {/* Navigation Links */}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button color="inherit" onClick={() => navigate('/')}>Dashboard</Button>
            <Button color="inherit" onClick={() => navigate('/groups')}>Groups</Button>
            <Button color="inherit" onClick={() => navigate('/time')}>Server Time</Button>
            <Button color="inherit" onClick={() => navigate('/settings')}>Settings</Button>
          </Box>
        
        </Toolbar>
      </AppBar>

      {/* Main Page Content */}
      <Container component="main" maxWidth="lg" sx={{ mt: 4, mb: 4, flexGrow: 1 }}>
        {children}
      </Container>
    </Box>
  );
}