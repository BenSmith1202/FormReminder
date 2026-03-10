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
  Tooltip,
  Container,
  Avatar,
  Skeleton,
} from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import GroupIcon from '@mui/icons-material/Group';
import PersonIcon from '@mui/icons-material/Person';
import VisibilityIcon from '@mui/icons-material/Visibility';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';

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

export default function EditGroup() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();

  const [group, setGroup] = useState<Group | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [newEmails, setNewEmails] = useState('');

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

  const handleSaveDetails = async () => {
    setSavingDetails(true);
    setSuccessMsg(null);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/api/groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, description }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update group details');
      setGroup((prev) => (prev ? { ...prev, name, description } : null));
      setSuccessMsg('Group details updated successfully!');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingDetails(false);
    }
  };

  const handleAddMembers = async () => {
    if (!newEmails.trim()) return;
    setAddingMembers(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/api/groups/${groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ emails: newEmails }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to add members');
      alert(`Added ${data.added_count} member${data.added_count !== 1 ? 's' : ''}!${data.skipped > 0 ? ` (${data.skipped} duplicate${data.skipped !== 1 ? 's' : ''} skipped)` : ''}`);
      setNewEmails('');
      loadGroup();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAddingMembers(false);
    }
  };

  const handleRemoveMember = async (email: string) => {
    if (!window.confirm(`Remove ${email} from this group?`)) return;
    try {
      const response = await fetch(
        `${API_URL}/api/groups/${groupId}/members/${encodeURIComponent(email)}`,
        { method: 'DELETE', credentials: 'include' }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to remove member');
      if (group) {
        setGroup({
          ...group,
          members: group.members.filter((m) => m.email !== email),
          member_count: group.member_count - 1,
        });
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteGroup = async () => {
    const confirmText = prompt(`To confirm deletion, type the group name: "${group?.name}"`);
    if (confirmText !== group?.name) {
      if (confirmText !== null) alert('Group name does not match.');
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
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Skeleton variant="rectangular" height={40} sx={{ mb: 3, borderRadius: 1 }} />
        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <Skeleton variant="rectangular" height={320} sx={{ borderRadius: 2 }} />
          </Grid>
          <Grid item xs={12} md={8}>
            <Skeleton variant="rectangular" height={480} sx={{ borderRadius: 2 }} />
          </Grid>
        </Grid>
      </Container>
    );
  }

  if (error && !group) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/groups')}>
          Back to Groups
        </Button>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* ── Page Header ── */}
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        mb={4}
        flexWrap="wrap"
        gap={2}
      >
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(`/groups/${groupId}`)}
          color="inherit"
          sx={{ color: 'text.secondary' }}
        >
          Back to Group
        </Button>
        <Button
          variant="outlined"
          startIcon={<VisibilityIcon />}
          onClick={() => navigate(`/groups/${groupId}`)}
        >
          View Group
        </Button>
      </Box>

      {/* Title */}
      <Box display="flex" alignItems="center" gap={1.5} mb={3}>
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 2,
            bgcolor: 'primary.50',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <GroupIcon color="primary" sx={{ fontSize: 24 }} />
        </Box>
        <Box>
          <Typography variant="h5" fontWeight="bold">
            Edit Group
          </Typography>
          {group && (
            <Typography variant="body2" color="text.secondary">
              {group.name}
            </Typography>
          )}
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {successMsg && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccessMsg(null)}>
          {successMsg}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* ── Left Column: Settings ── */}
        <Grid item xs={12} md={4}>
          <Stack spacing={3}>
            {/* General Settings */}
            <Paper sx={{ p: 3 }}>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                General Settings
              </Typography>
              <Divider sx={{ mb: 2.5 }} />
              <Stack spacing={2.5}>
                <TextField
                  label="Group Name"
                  fullWidth
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  size="small"
                />
                <TextField
                  label="Description"
                  fullWidth
                  multiline
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  size="small"
                />
                <Button
                  variant="contained"
                  startIcon={
                    savingDetails ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <SaveIcon />
                    )
                  }
                  onClick={handleSaveDetails}
                  disabled={savingDetails || !name.trim()}
                  fullWidth
                >
                  {savingDetails ? 'Saving...' : 'Save Changes'}
                </Button>
              </Stack>
            </Paper>

            {/* Danger Zone */}
            <Paper
              sx={{
                p: 3,
                border: '1px solid',
                borderColor: 'error.light',
                bgcolor: '#fff8f8',
              }}
            >
              <Box display="flex" alignItems="center" gap={1} mb={1}>
                <WarningAmberIcon color="error" fontSize="small" />
                <Typography variant="subtitle1" fontWeight="bold" color="error">
                  Danger Zone
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Deleting this group will remove it from all associated Form Requests. This action
                cannot be undone.
              </Typography>
              <Button
                variant="outlined"
                color="error"
                size="small"
                startIcon={<DeleteIcon />}
                onClick={handleDeleteGroup}
                fullWidth
              >
                Delete Group
              </Button>
            </Paper>
          </Stack>
        </Grid>

        {/* ── Right Column: Members ── */}
        <Grid item xs={12} md={8}>
          <Stack spacing={3}>
            {/* Add Members */}
            <Paper sx={{ p: 3 }}>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <PersonAddIcon color="primary" fontSize="small" />
                <Typography variant="subtitle1" fontWeight="bold">
                  Add Members
                </Typography>
              </Box>
              <TextField
                fullWidth
                multiline
                rows={3}
                size="small"
                placeholder={
                  'Paste emails here (space or newline separated)\nalice@example.com\nbob@example.com'
                }
                value={newEmails}
                onChange={(e) => setNewEmails(e.target.value)}
                sx={{ mb: 2 }}
              />
              <Button
                variant="contained"
                onClick={handleAddMembers}
                disabled={!newEmails.trim() || addingMembers}
                startIcon={addingMembers ? <CircularProgress size={16} color="inherit" /> : <PersonAddIcon />}
                fullWidth
              >
                {addingMembers ? 'Adding...' : 'Add Members'}
              </Button>
            </Paper>

            {/* Current Members */}
            <Paper sx={{ overflow: 'hidden' }}>
              <Box
                px={3}
                py={2}
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}
              >
                <Box display="flex" alignItems="center" gap={1}>
                  <PeopleAltIcon fontSize="small" color="action" />
                  <Typography variant="subtitle1" fontWeight="bold">
                    Current Members
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {group?.member_count || 0} total
                </Typography>
              </Box>

              {group?.members.length === 0 ? (
                <Box p={4} textAlign="center">
                  <PeopleAltIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                  <Typography variant="body2" color="text.secondary">
                    No members yet. Add emails above to get started.
                  </Typography>
                </Box>
              ) : (
                <List sx={{ maxHeight: 440, overflow: 'auto', p: 0 }}>
                  {group?.members.map((member, index) => (
                    <ListItem
                      key={index}
                      divider={index < (group?.members.length ?? 0) - 1}
                      sx={{ px: 3, py: 1.5 }}
                    >
                      <Avatar
                        sx={{
                          width: 34,
                          height: 34,
                          bgcolor: 'grey.100',
                          color: 'text.secondary',
                          mr: 2,
                          flexShrink: 0,
                        }}
                      >
                        <PersonIcon sx={{ fontSize: 18 }} />
                      </Avatar>
                      <ListItemText
                        primary={
                          <Typography variant="body2" fontWeight="medium">
                            {member.email}
                          </Typography>
                        }
                        secondary={`Added ${new Date(member.added_at).toLocaleDateString()}`}
                      />
                      <ListItemSecondaryAction>
                        <Tooltip title="Remove member">
                          <IconButton
                            edge="end"
                            size="small"
                            onClick={() => handleRemoveMember(member.email)}
                          >
                            <DeleteIcon fontSize="small" color="action" />
                          </IconButton>
                        </Tooltip>
                      </ListItemSecondaryAction>
                    </ListItem>
                  ))}
                </List>
              )}
            </Paper>
          </Stack>
        </Grid>
      </Grid>
    </Container>
  );
}