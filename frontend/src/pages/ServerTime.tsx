import { useEffect, useState } from 'react';
import { Box, Typography, Paper, Button, CircularProgress, Stack, Alert } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import RefreshIcon from '@mui/icons-material/Refresh';

interface TimeResponse {
  current_time: string;
}

export default function ServerTime() {
  const [time, setTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTime = () => {
    setLoading(true);
    setError(null);
    
    // Note: Fetching from /time as per your python snippet (not /api/time)
    fetch('http://127.0.0.1:5000/time')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
        return res.json();
      })
      .then((data: TimeResponse) => {
        // Format the ISO string into a readable date and time
        const dateObj = new Date(data.current_time);
        setTime(dateObj.toLocaleString());
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch time", err);
        setError("Could not connect to server. Is Flask running?");
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchTime();
  }, []);

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', mt: 4 }}>
        <Paper elevation={3} sx={{ p: 4, borderRadius: 2, textAlign: 'center' }}>
            
            <Stack spacing={3} alignItems="center">
                <Box sx={{ 
                    bgcolor: 'primary.light', 
                    color: 'primary.contrastText', 
                    p: 2, 
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 80,
                    height: 80
                }}>
                    <AccessTimeIcon sx={{ fontSize: 40 }} />
                </Box>

                <Typography variant="h4" component="h1" fontWeight="bold">
                    Server Time Check
                </Typography>

                <Typography variant="body1" color="text.secondary">
                    This page fetches the live system time directly from your Flask backend.
                </Typography>

                <Box sx={{ 
                    p: 3, 
                    bgcolor: '#f8f9fa', 
                    borderRadius: 2, 
                    width: '100%', 
                    border: '1px solid #e0e0e0',
                    minHeight: 100,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    {loading ? (
                        <CircularProgress size={30} />
                    ) : error ? (
                        <Alert severity="error" sx={{ width: '100%' }}>{error}</Alert>
                    ) : (
                        <Typography variant="h3" sx={{ fontFamily: 'monospace', fontWeight: 'bold', color: 'primary.main' }}>
                            {time?.split(',')[1]} 
                            <Typography component="span" variant="h6" color="text.secondary" display="block">
                                {time?.split(',')[0]}
                            </Typography>
                        </Typography>
                    )}
                </Box>

                <Button 
                    variant="contained" 
                    startIcon={<RefreshIcon />} 
                    onClick={fetchTime}
                    size="large"
                    disabled={loading}
                >
                    Refresh Time
                </Button>
            </Stack>
        </Paper>
    </Box>
  );
}