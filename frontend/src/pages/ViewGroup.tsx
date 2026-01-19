import { useState, useEffect } from 'react';
import { Paper, Typography, Button, Box, CircularProgress, Alert, IconButton, TextField, List, ListItem, ListItemText, ListItemSecondaryAction, Chip } from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import GroupIcon from '@mui/icons-material/Group';

const API_URL = 'http://localhost:5000';

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

export default function ViewGroup() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emails, setEmails] = useState('');
  const [addingMembers, setAddingMembers] = useState(false);

  useEffect(() => {
    loadGroup();
  }, [groupId]);

  const loadGroup = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/groups/${groupId}`, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to load group');
      }
      
      const data = await response.json();
      console.log('Loaded group:', data);
      setGroup(data.group);
    } catch (err: any) {
      console.error('Error loading group:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (!group) return;
    const inviteLink = `${window.location.origin}/groups/join/${group.invite_token}`;
    navigator.clipboard.writeText(inviteLink);
    alert('Invite link copied to clipboard!');
  };

  const handleAddMembers = async () => {
    if (!emails.trim() || !group) return;
    
    setAddingMembers(true);
    try {
      const response = await fetch(`${API_URL}/api/groups/${groupId}/members`, {
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
      
      // Reload group to see new members
      loadGroup();
      
    } catch (err: any) {
      console.error('❌ Failed to add members:', err);
      alert(err.message);
    } finally {
      setAddingMembers(false);
    }
  };

  const handleDeleteMember = async (email: string) => {
    if (!window.confirm(`Remove ${email} from this group?`)) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/groups/${groupId}/members/${encodeURIComponent(email)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove member');
      }
      
      console.log('✅ Member removed:', data);
      
      // Reload group to see updated list
      loadGroup();
      
    } catch (err: any) {
      console.error('❌ Failed to remove member:', err);
      alert(err.message);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error || !group) {
    return (
      <Box>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || 'Group not found'}
        </Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/groups')}>
          Back to Groups
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/groups')} sx={{ mb: 2 }}>
        Back to Groups
      </Button>

      <Paper sx={{ p: 4, mb: 3 }}>
        <Box display="flex" alignItems="center" mb={2}>
          <GroupIcon sx={{ mr: 2, fontSize: 40, color: 'primary.main' }} />
          <Box>
            <Typography variant="h4">
              {group.name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {group.description || 'No description'}
            </Typography>
          </Box>
        </Box>

        <Box display="flex" gap={2} alignItems="center" mt={3}>
          <Chip label={`${group.member_count} members`} color="primary" />
          <Button
            variant="outlined"
            startIcon={<ContentCopyIcon />}
            onClick={handleCopyLink}
            size="small"
          >
            Copy Invite Link
          </Button>
        </Box>
      </Paper>

      {/* Add Members Section */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Add Members
        </Typography>
        <TextField
          fullWidth
          multiline
          rows={3}
          placeholder="Paste emails here (separated by spaces or newlines)&#10;&#10;example1@email.com example2@email.com&#10;example3@email.com"
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          sx={{ mb: 2 }}
        />
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleAddMembers}
          disabled={!emails.trim() || addingMembers}
        >
          {addingMembers ? 'Adding...' : 'Add Emails'}
        </Button>
      </Paper>

      {/* Members List */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Members ({group.members.length})
        </Typography>
        {group.members.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            No members yet. Add emails or share the invite link.
          </Typography>
        ) : (
          <List>
            {group.members.map((member, index) => (
              <ListItem key={index} divider={index < group.members.length - 1}>
                <ListItemText
                  primary={member.email}
                  secondary={`Added ${new Date(member.added_at).toLocaleDateString()}`}
                />
                <ListItemSecondaryAction>
                  <IconButton edge="end" aria-label="delete" onClick={() => handleDeleteMember(member.email)}>
                    <DeleteIcon />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    </Box>
  );
}
