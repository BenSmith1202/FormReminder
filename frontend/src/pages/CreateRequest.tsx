import { useState } from 'react';
import { Paper, Typography, TextField, Button, Box, Alert } from '@mui/material';

export default function CreateRequest() {
  const [formUrl, setFormUrl] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Send this URL to the Flask backend to extract the Form ID
    console.log("Submitting URL:", formUrl);
    setSubmitted(true);
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

        {submitted && (
          <Alert severity="success" sx={{ mb: 2 }}>
            Request created! (Mock logic)
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
          />
          
          <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
            <Button variant="contained" size="large" type="submit">
              Next Step
            </Button>
            <Button variant="text" size="large">
              Cancel
            </Button>
          </Box>
        </form>
      </Paper>
    </Box>
  );
}