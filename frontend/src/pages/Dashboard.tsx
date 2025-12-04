import { useEffect, useState } from 'react';
import { Paper, Typography, Box, CircularProgress, Chip, Stack } from '@mui/material';

// Interface for the data we expect from Flask
interface HealthResponse {
  status: string;
  database: string;
  submission_count?: number; // Optional until backend implements it fully
}

export default function Dashboard() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch from Flask Backend
    fetch('http://127.0.0.1:5000/api/health')
      .then((res) => res.json())
      .then((data) => {
        setData(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch", err);
        setLoading(false);
      });
  }, []);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 5 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Your Form Requests
      </Typography>

      {/* Milestone 1 Goal: Display Live Submission Count */}
      {/* Switching to Stack for a simpler, more robust layout than Grid */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
        {/* Card 1: System Status */}
        <Box sx={{ flex: 1 }}>
          <Paper sx={{ p: 3, display: 'flex', flexDirection: 'column', height: 140 }}>
            <Typography component="h2" variant="h6" color="primary" gutterBottom>
              System Status
            </Typography>
            <Box>
               Status: <Chip label={data?.status || "Unknown"} color="success" size="small" />
            </Box>
            <Box sx={{ mt: 1 }}>
               Database: <Chip label={data?.database || "Unknown"} color="primary" size="small" />
            </Box>
          </Paper>
        </Box>

        {/* Card 2: Live Submissions (The core metric) */}
        <Box sx={{ flex: 1 }}>
          <Paper sx={{ p: 3, display: 'flex', flexDirection: 'column', height: 140 }}>
            <Typography component="h2" variant="h6" color="primary" gutterBottom>
              Live Submissions
            </Typography>
            <Typography component="p" variant="h3">
              {data?.submission_count || 0}
            </Typography>
            <Typography color="text.secondary" sx={{ flex: 1 }}>
              responses recorded today
            </Typography>
          </Paper>
        </Box>
      </Stack>
    </Box>
  );
}