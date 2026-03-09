import { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  Button,
  Box,
  CircularProgress,
  Alert,
  IconButton,
  TextField,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
  Grid,
  Stack,
  Tooltip
} from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import GroupIcon from '@mui/icons-material/Group';

import API_URL from '../config';

interface Member {
  email: string;
  status: string;
  added_at: string;
}

interface Group {
  id: string;
  name: string;
  description: string;
  invite_token: string;
  member_count: number;
  members: Member[];
  created_at: string;
}

export default function EditGroup() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  
  // Data State
  const [group, setGroup] = useState<Group | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  
  // Member Management State
  const [newEmails, setNewEmails] = useState('');
  
  // UI State
  const [loading, setLoading] = useState(true);
  const [savingDetails, setSavingDetails] = useState(false);
  const [addingMembers, setAddingMembers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    loadGroup();
  }, [groupId]);

  const loadGroup = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/groups/${groupId}`, {
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Failed to load group');
      
      const data = await response.json();
      const groupData = data.group;
      
      setGroup(groupData);
      setName(groupData.name);
      setDescription(groupData.description || '');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Uses the new PUT route
  const handleSaveDetails = async () => {
    setSavingDetails(true);
    setSuccessMsg(null);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, description })
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Failed to update group details');
      
      // Update local state
      setGroup(prev => prev ? { ...prev, name, description } : null);
      setSuccessMsg('Group details updated successfully!');
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingDetails(false);
    }
  };

  // Uses existing POST /members route
  const handleAddMembers = async () => {
    if (!newEmails.trim()) return;
    
    setAddingMembers(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/groups/${groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ emails: newEmails })
      });
      
      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error || 'Failed to add members');
      
      // Show result
      alert(`Added ${data.added_count} members!${data.skipped > 0 ? ` (${data.skipped} duplicates skipped)` : ''}`);
      setNewEmails('');
      
      // Reload the group to refresh the list
      loadGroup();
      
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAddingMembers(false);
    }
  };

  // Uses existing DELETE /members/<email> route
  const handleRemoveMember = async (email: string) => {
    if (!window.confirm(`Remove ${email} from this group?`)) return;

    try {
      const response = await fetch(`${API_URL}/api/groups/${groupId}/members/${encodeURIComponent(email)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Failed to remove member');
      
      // Optimistically update UI
      if (group) {
        setGroup({
          ...group,
          members: group.members.filter(m => m.email !== email),
          member_count: group.member_count - 1
        });
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Optional: Delete Group Functionality
  const handleDeleteGroup = async () => {
    const confirmText = prompt(`To confirm deletion, type the group name: "${group?.name}"`);
    if (confirmText !== group?.name) {
      if (confirmText !== null) alert("Group name does not match.");
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/groups/${groupId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Failed to delete group');

      navigate('/groups');
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error && !group) {
    return (
      <Box p={3}>
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/groups')}>Back to Groups</Button>
      </Box>
    );
  }

  return (
    <Box maxWidth="lg" sx={{ mx: 'auto', p: 3 }}>
      {/* Header */}
      <Box display="flex" alignItems="center" mb={4}>
        <IconButton onClick={() => navigate(`/groups/${groupId}`)} sx={{ mr: 2 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4" fontWeight="bold">
          Edit Group
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccessMsg(null)}>{successMsg}</Alert>}

      <Grid container spacing={4}>
        
        {/* Left Column: Group Settings */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <GroupIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">General Settings</Typography>
            </Box>
            <Divider sx={{ mb: 3 }} />
            
            <Stack spacing={3}>
              <TextField
                label="Group Name"
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <TextField
                label="Description"
                fullWidth
                multiline
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <Button
                variant="contained"
                startIcon={savingDetails ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
                onClick={handleSaveDetails}
                disabled={savingDetails || !name.trim()}
              >
                {savingDetails ? 'Saving...' : 'Save Changes'}
              </Button>
            </Stack>
          </Paper>

          {/* Danger Zone */}
          <Paper sx={{ p: 3, border: '1px solid', borderColor: 'error.light', bgcolor: '#fff5f5' }}>
            <Typography variant="h6" color="error" gutterBottom>Danger Zone</Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Deleting this group will remove it from all associated Form Requests.
            </Typography>
            <Button 
              variant="outlined" 
              color="error" 
              startIcon={<DeleteIcon />}
              onClick={handleDeleteGroup}
            >
              Delete Group
            </Button>
          </Paper>
        </Grid>

        {/* Right Column: Member Management */}
        <Grid size={{ xs: 12, md: 7 }}>
          {/* Add Members */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <PersonAddIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">Add Members</Typography>
            </Box>
            <TextField
              fullWidth
              multiline
              rows={3}
              placeholder="Paste emails here (space or newline separated)&#10;alice@example.com&#10;bob@example.com"
              value={newEmails}
              onChange={(e) => setNewEmails(e.target.value)}
              sx={{ mb: 2 }}
            />
            <Button
              variant="contained"
              onClick={handleAddMembers}
              disabled={!newEmails.trim() || addingMembers}
              fullWidth
            >
              {addingMembers ? 'Adding...' : 'Add Members'}
            </Button>
          </Paper>

          {/* Member List */}
          <Paper sx={{ p: 0, overflow: 'hidden' }}>
            <Box p={2} bgcolor="grey.50" borderBottom={1} borderColor="divider">
              <Typography variant="h6">
                Current Members ({group?.member_count || 0})
              </Typography>
            </Box>
            
            <List sx={{ maxHeight: 500, overflow: 'auto', bgcolor: 'background.paper' }}>
              {group?.members.length === 0 ? (
                <ListItem>
                  <ListItemText secondary="No members in this group yet." sx={{ textAlign: 'center', py: 2 }} />
                </ListItem>
              ) : (
                group?.members.map((member, index) => (
                  <ListItem key={index} divider={index < group.members.length - 1}>
                    <ListItemText
                      primary={member.email}
                      secondary={`Joined ${new Date(member.added_at).toLocaleDateString()}`}
                    />
                    <ListItemSecondaryAction>
                      <Tooltip title="Remove member">
                        <IconButton edge="end" onClick={() => handleRemoveMember(member.email)}>
                          <DeleteIcon color="action" />
                        </IconButton>
                      </Tooltip>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))
              )}
            </List>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}