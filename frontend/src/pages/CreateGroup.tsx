import { useState } from 'react';
import { Paper, Typography, TextField, Button, Box, Alert, Dialog, DialogTitle, DialogContent, DialogActions, IconButton } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

import API_URL from '../config';

export default function CreateGroup() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [createdGroup, setCreatedGroup] = useState<any>(null);
  const [emails, setEmails] = useState('');
  const [addingMembers, setAddingMembers] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      console.log('Creating group:', { name, description });
      
      const response = await fetch(`${API_URL}/api/groups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          name,
          description
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create group');
      }
      
      console.log('✅ Group created:', data);
      setCreatedGroup(data.group);
      setShowSuccess(true);
      
    } catch (err: any) {
      console.error('❌ Failed to create group:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddMembers = async () => {
    if (!emails.trim() || !createdGroup) return;
    
    setAddingMembers(true);
    try {
      const response = await fetch(`${API_URL}/api/groups/${createdGroup.id}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ emails })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to add members');
      }
      
      console.log('✅ Members added:', data);
      alert(`Added ${data.added_count} members!${data.skipped > 0 ? ` (${data.skipped} duplicates skipped)` : ''}`);
      setEmails('');
      
      // Update member count
      setCreatedGroup({
        ...createdGroup,
        member_count: data.total_members
      });
      
    } catch (err: any) {
      console.error('❌ Failed to add members:', err);
      alert(err.message);
    } finally {
      setAddingMembers(false);
    }
  };

  const handleCopyLink = () => {
    if (!createdGroup) return;
    const inviteLink = `${window.location.origin}/groups/join/${createdGroup.invite_token}`;
    navigator.clipboard.writeText(inviteLink);
    alert('Invite link copied to clipboard!');
  };

  const handleClose = () => {
    setShowSuccess(false);
    navigate('/groups');
  };

  return (
    <Box maxWidth="sm" sx={{ mx: 'auto' }}>
      <Paper sx={{ p: 4 }}>
        <Typography variant="h5" gutterBottom>
          Create a New Group
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Groups help you organize recipients for your form requests
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <TextField
            label="Group Name"
            fullWidth
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            sx={{ mb: 2 }}
            placeholder="e.g., Team Alpha"
          />
          
          <TextField
            label="Description"
            fullWidth
            multiline
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            sx={{ mb: 3 }}
            placeholder="Optional description for this group"
          />

          <Box display="flex" gap={2}>
            <Button
              variant="outlined"
              onClick={() => navigate('/groups')}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={loading || !name.trim()}
              fullWidth
            >
              {loading ? 'Creating...' : 'Create Group'}
            </Button>
          </Box>
        </form>
      </Paper>

      {/* Success Dialog */}
      <Dialog open={showSuccess} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>🎉 Group Created Successfully!</DialogTitle>
        <DialogContent>
          <Typography variant="h6" gutterBottom>
            {createdGroup?.name}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {createdGroup?.member_count || 0} members
          </Typography>

          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" gutterBottom>
              Invite Link:
            </Typography>
            <Box display="flex" alignItems="center" gap={1}>
              <TextField
                fullWidth
                size="small"
                value={`${window.location.origin}/groups/join/${createdGroup?.invite_token}`}
                InputProps={{
                  readOnly: true,
                }}
              />
              <IconButton onClick={handleCopyLink} color="primary">
                <ContentCopyIcon />
              </IconButton>
            </Box>
            <Typography variant="caption" color="text.secondary">
              Share this link with people to invite them to the group
            </Typography>
          </Box>

          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Or add members manually:
            </Typography>
            <TextField
              fullWidth
              multiline
              rows={4}
              placeholder="Paste emails here (separated by spaces or newlines)&#10;&#10;example1@email.com example2@email.com&#10;example3@email.com"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              sx={{ mb: 1 }}
            />
            <Button
              variant="outlined"
              onClick={handleAddMembers}
              disabled={!emails.trim() || addingMembers}
              fullWidth
            >
              {addingMembers ? 'Adding...' : 'Add Emails'}
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} variant="contained">
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
