/**
 * @file CreateGroup.tsx
 * @description Provides a form for users to create a new recipient group.
 * Upon successful creation, it presents a dialog allowing the user to copy 
 * an invite link or manually bulk-add members via email addresses.
 */

import { useState } from 'react';
import { Paper, Typography, TextField, Button, Box, Dialog, DialogContent, DialogActions, IconButton, Divider } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LinkIcon from '@mui/icons-material/Link';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';


import API_URL from '../config';
import AnimatedInfoButton from '../components/InfoButton';
import ErrorSnackbar from '../components/ErrorSnackbar';

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
      let msg = `Added ${data.added_count} member${data.added_count !== 1 ? 's' : ''}!`;
      if (data.skipped_invalid > 0) msg += ` Skipped ${data.skipped_invalid} email${data.skipped_invalid !== 1 ? 's' : ''} with improper formatting.`;
      if (data.skipped > 0) msg += ` (${data.skipped} duplicate${data.skipped !== 1 ? 's' : ''} skipped)`;
      alert(msg);
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
  const handleClose = async () => {
    // Add any pending emails before closing
    if (emails.trim() && createdGroup) {
      await handleAddMembers();
    }
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

        <ErrorSnackbar error={error} onClose={() => setError(null)} />

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
            inputProps={{ maxLength: 500 }} // Limit description to 500
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
      <Dialog open={showSuccess} onClose={handleClose} maxWidth="sm" fullWidth
        PaperProps={{ sx: { borderRadius: 3, overflow: 'hidden' } }}
      >
        {/* Header */}
        <Box sx={{ px: { xs: 3, sm: 4 }, pt: { xs: 3, sm: 4 }, pb: 0 }}>
          <Box display="flex" alignItems="center" gap={2} mb={2}>
            <Box sx={{
              width: 48, height: 48, borderRadius: 2,
              bgcolor: 'success.50', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <CheckCircleIcon sx={{ color: 'success.main', fontSize: 26 }} />
            </Box>
            <Box>
              <Typography variant="h6" fontWeight="bold">Group Created!</Typography>
              <Typography variant="body2" color="text.secondary">
                <strong>{createdGroup?.name}</strong> &middot; {createdGroup?.member_count || 0} members
              </Typography>
            </Box>
          </Box>
        </Box>

        <DialogContent sx={{ px: { xs: 3, sm: 4 }, pt: 2 }}>
          {/* Invite Link Section */}
          <Box sx={{ mb: 3 }}>
            <Box display="flex" alignItems="center" gap={1.5} mb={1.5}>
              <Box sx={{
                width: 36, height: 36, borderRadius: 1.5,
                bgcolor: 'primary.50', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <LinkIcon sx={{ color: 'primary.main', fontSize: 18 }} />
              </Box>
              <Typography variant="subtitle1" fontWeight="bold">
                Invite Link
              </Typography>
              <AnimatedInfoButton title="Invite Link">
                <p>Share this link with the people you'd like to add to the group.</p>
                <p>When they click the link, they'll be prompted to join the group automatically — no manual entry needed.</p>
                <p>This is the easiest way to add people who can sign up on their own.</p>
              </AnimatedInfoButton>
            </Box>
            <Divider sx={{ mb: 2 }} />
            <Box display="flex" alignItems="center" gap={1}>
              <TextField
                fullWidth size="small"
                value={`${window.location.origin}/groups/join/${createdGroup?.invite_token}`}
                InputProps={{ readOnly: true, sx: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
              />
              <IconButton onClick={handleCopyLink} color="primary" sx={{
                border: '1px solid', borderColor: 'primary.main', borderRadius: 2,
                '&:hover': { bgcolor: 'primary.50' },
              }}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
              Anyone with this link can join the group.
            </Typography>
          </Box>

          {/* Manual Members Section */}
          <Box>
            <Box display="flex" alignItems="center" gap={1.5} mb={1.5}>
              <Box sx={{
                width: 36, height: 36, borderRadius: 1.5,
                bgcolor: 'success.50', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <PersonAddIcon sx={{ color: 'success.main', fontSize: 18 }} />
              </Box>
              <Typography variant="subtitle1" fontWeight="bold">
                Add Members Manually
              </Typography>
              <AnimatedInfoButton title="Add Members Manually">
                <p>Use this section to directly add people by their email addresses.</p>
                <p>This is useful when you already know exactly who should be in the group and want to add them right away without sending a link.</p>
                <p>Separate multiple emails with spaces or new lines.</p>
              </AnimatedInfoButton>
            </Box>
            <Divider sx={{ mb: 2 }} />
            <TextField
              fullWidth multiline rows={3} size="small"
              placeholder={'alice@example.com\nbob@example.com\ncarol@example.com'}
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              sx={{ mb: 1.5 }}
            />
            <Button
              variant="outlined" color="success"
              startIcon={addingMembers ? undefined : <PersonAddIcon />}
              onClick={handleAddMembers}
              disabled={!emails.trim() || addingMembers}
              fullWidth
            >
              {addingMembers ? 'Adding...' : 'Add Emails'}
            </Button>
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: { xs: 3, sm: 4 }, py: 2.5 }}>
          <Button onClick={handleClose} variant="contained" size="large" sx={{ minWidth: 120 }}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}