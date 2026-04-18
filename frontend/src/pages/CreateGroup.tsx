/**
 * @file CreateGroup.tsx
 * @description Provides a form for users to create a new recipient group.
 * Upon successful creation, it presents a dialog allowing the user to copy 
 * an invite link or manually bulk-add members via email addresses.
 */

import { useState } from 'react';
import { Paper, Typography, TextField, Button, Box, Alert, Dialog, DialogTitle, DialogContent, DialogActions, IconButton } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

import API_URL from '../config';
import AnimatedInfoButton from '../components/InfoButton';

export default function CreateGroup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // If the user arrived from CreateRequest, we'll send them back afterwards
  const returnTo = searchParams.get('returnTo');
  
  // --- Form & UI State ---
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // --- Success Dialog State ---
  const [showSuccess, setShowSuccess] = useState(false);
  const [createdGroup, setCreatedGroup] = useState<any>(null); // Stores the response object of the newly created group
  
  // --- Member Addition State ---
  const [emails, setEmails] = useState('');
  const [addingMembers, setAddingMembers] = useState(false);

  /**
   * Submits the new group data to the backend.
   * On success, it halts the form UI and opens the success dialog 
   * so the user can immediately start adding members.
   */
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
      
      console.log('Group created:', data);
      setCreatedGroup(data.group);
      setShowSuccess(true);
      
    } catch (err: any) {
      console.error('Failed to create group:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Takes the raw string from the email textarea, sends it to the backend 
   * to be parsed, and adds those users to the newly created group.
   * Updates the local group state with the new member count upon success.
   */
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
      
      console.log('Members added:', data);
      alert(`Added ${data.added_count} members!${data.skipped > 0 ? ` (${data.skipped} duplicates skipped)` : ''}`);
      setEmails('');
      
      // Update member count in the dialog UI
      setCreatedGroup({
        ...createdGroup,
        member_count: data.total_members
      });
      
    } catch (err: any) {
      console.error('Failed to add members:', err);
      alert(err.message);
    } finally {
      setAddingMembers(false);
    }
  };

  /**
   * Generates the unique invite link for the new group and writes it 
   * directly to the user's system clipboard.
   */
  const handleCopyLink = () => {
    if (!createdGroup) return;
    const inviteLink = `${window.location.origin}/groups/join/${createdGroup.invite_token}`;
    navigator.clipboard.writeText(inviteLink);
    alert('Invite link copied to clipboard!');
  };

  /**
   * Closes the success dialog and redirects the user.
   * If we came from CreateRequest (returnTo=create-request), go back there
   * with the new group ID so it can be auto-selected in the dropdown.
   * Otherwise, go to the groups dashboard.
   */
  const handleClose = () => {
    setShowSuccess(false);
    if (returnTo === 'create-request' && createdGroup?.id) {
      navigate(`/requests/new?newGroupId=${createdGroup.id}`);
    } else {
      navigate('/groups');
    }
  };

  return (
    <Box maxWidth="sm" sx={{ mx: 'auto' }}>
      <Paper sx={{ p: 4 }}>
        <Typography variant="h5" component="h1" gutterBottom>
          Create a New Group  <AnimatedInfoButton title="Creating a Group">
                                <p>What is a group?</p>
                                <p>A group is a collection of recipients that you can easily manage and send form requests to. Here you can create a group, give it a description, and add members to it. Then, when you want to send a form request, you can simply select the group as the recipient.</p>
                                <p>Groups are perfect for teams, departments, or any set of people you frequently need to contact together. You can add or remove members from a group at any time, and each group has its own unique invite link for easy sharing.</p>
                              </AnimatedInfoButton>
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
            inputProps={{ maxLength: 50 }} // Limit name to 50
            helperText={`${name.length}/50`}
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
            inputProps={{ maxLength: 300 }} // Limit description to 300
            helperText={`${description.length}/300`}
          />

          <Box display="flex" gap={2}>
            <Button
              variant="outlined"
              onClick={() => {
                // Go back to CreateRequest if we came from there, otherwise groups list
                if (returnTo === 'create-request') {
                  navigate('/requests/new');
                } else {
                  navigate('/groups');
                }
              }}
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
        <DialogTitle>Group Created Successfully!</DialogTitle>
        <DialogContent>
          <Typography variant="h6" component="p" gutterBottom>
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