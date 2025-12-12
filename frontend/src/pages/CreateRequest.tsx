import { useState } from 'react';
import { Paper, Typography, TextField, Button, Box, Alert, CircularProgress } from '@mui/material';
import { useNavigate } from 'react-router-dom';

export default function CreateRequest() {
  const navigate = useNavigate();
  const [formUrl, setFormUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    // Step 1: Extract form ID from URL using backend endpoint
    const formIdEndpoint = `http://127.0.0.1:5000/api/getid?formlink=${encodeURIComponent(formUrl)}`;
    
    fetch(formIdEndpoint)
      .then((res) => {
        if (!res.ok) {
          return res.json().then(err => { throw new Error(err.error || `HTTP error! status: ${res.status}`); });
        }
        return res.json();
      })
      .then((data) => {
        console.log("Extracted Form ID:", data.form_id);
        console.log("Form URL:", data.form_url);
        
        // Step 2: Create form request with the extracted ID
        return fetch('http://127.0.0.1:5000/api/form-requests', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            form_id: data.form_id,
            form_url: data.form_url,
            name: `Form ${data.form_id.substring(0, 8)}` // Default name
          })
        });
      })
      .then((res) => {
        if (!res.ok) {
          return res.json().then(err => { throw new Error(err.error || `HTTP error! status: ${res.status}`); });
        }
        return res.json();
      })
      .then((data) => {
        console.log("Form request created:", data);
        // Navigate to dashboard after successful creation
        navigate('/');
      })
      .catch((err) => {
        console.error("Failed to create form request", err);
        setError(err.message || "Failed to create form request. Please try again.");
        setLoading(false);
      });
  };

  const handleCancel = () => {
    navigate('/');
  };

  return (
    <Box maxWidth="sm" sx={{ mx: 'auto' }}>
      <Paper sx={{ p: 4 }}>
        <Typography variant="h5" gutterBottom>
          Create a New Form Request
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Paste the link to your Google Form below. We will automatically track responses.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <TextField
            fullWidth
            label="Form URL"
            placeholder="https://docs.google.com/forms/d/..."
            variant="outlined"
            margin="normal"
            value={formUrl}
            onChange={(e) => setFormUrl(e.target.value)}
            required
            disabled={loading}
          />
          
          <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
            <Button 
              variant="contained" 
              size="large" 
              type="submit"
              disabled={loading}
              startIcon={loading ? <CircularProgress size={20} /> : null}
            >
              {loading ? 'Creating...' : 'Create Request'}
            </Button>
            <Button 
              variant="text" 
              size="large"
              onClick={handleCancel}
              disabled={loading}
            >
              Cancel
            </Button>
          </Box>
        </form>
      </Paper>
    </Box>
  );
}