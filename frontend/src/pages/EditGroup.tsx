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
  Tooltip,
  Container,
  Avatar,
  Skeleton,
  InputAdornment,
  Collapse,
} from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import GroupIcon from '@mui/icons-material/Group';
//import VisibilityIcon from '@mui/icons-material/Visibility';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import SearchIcon from '@mui/icons-material/Search';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import API_URL from '../config';
import AnimatedInfoButton from '../components/InfoButton';

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
  const [memberSearch, setMemberSearch] = useState('');
  const [dangerOpen, setDangerOpen] = useState(false);

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
      const response = await fetch(`${API_URL}/api/groups/${groupId}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to load group');
      const data = await response.json();
      const g = data.group;
      setGroup(g);
      setName(g.name);
      setDescription(g.description || '');
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
      alert(
        `Added ${data.added_count} member${data.added_count !== 1 ? 's' : ''}!` +
          (data.skipped > 0 ? ` (${data.skipped} duplicate${data.skipped !== 1 ? 's' : ''} skipped)` : '')
      );
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

  const filteredMembers =
    group?.members.filter((m) =>
      m.email.toLowerCase().includes(memberSearch.toLowerCase())
    ) ?? [];

  // ── Loading ──
  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Skeleton variant="rectangular" height={160} sx={{ borderRadius: 3, mb: 3 }} />
        <Skeleton variant="rectangular" height={140} sx={{ borderRadius: 3, mb: 3 }} />
        <Skeleton variant="rectangular" height={360} sx={{ borderRadius: 3 }} />
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
    <Container maxWidth="lg" sx={{ py: 4 }} className="page-fade-in">
      {/* ── Top nav ── */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(`/groups/${groupId}`)}
          sx={{ color: 'text.secondary' }}
        >
          Back to Group
        </Button>
        
      </Box>

      <Typography variant="h5" component="h1" fontWeight="bold" gutterBottom>
        Edit Group        <AnimatedInfoButton title="Editing a group">
                            <p>On this page, you can update the name and description of your group.</p>
                            <p>You can also add new members by entering their email addresses and clicking "Add Members". To remove a member, click the trash icon next to their email.</p>
                            <p>Be careful when deleting a group, as this action cannot be undone. Deleting a group will remove it from all associated form requests.</p>
                            <p> to return to the group details page without making changes, click "Back to Group".</p>
                          </AnimatedInfoButton>
      </Typography>

      {/* ── Alerts ── */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>
      )}
      {successMsg && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccessMsg(null)}>{successMsg}</Alert>
      )}

      {/* ── Section 1: General Settings ── */}
      <Paper
        elevation={0}
        sx={{ p: { xs: 3, sm: 4 }, mb: 3, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}
      >
        {/* Header row */}
        <Box display="flex" alignItems="center" gap={2} mb={3}>
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
            <GroupIcon color="primary" sx={{ fontSize: 22 }} />
          </Box>
          <Box>
            <Typography variant="subtitle1" fontWeight="bold">
              General Settings
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Update the name and description for this group.
            </Typography>
          </Box>
        </Box>

        <Divider sx={{ mb: 3 }} />

        {/* Responsive two-column form on md+ */}
        <Box
          display="grid"
          gridTemplateColumns={{ xs: '1fr', md: '1fr 2fr' }}
          gap={3}
          alignItems="start"
        >
          <TextField
            label="Group Name"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="small"
          />
          <Box display="flex" gap={2} alignItems="flex-start">
            <TextField
              label="Description"
              fullWidth
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              size="small"
              placeholder="Optional — describe the purpose of this group"
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
              sx={{ flexShrink: 0, height: 40 }}
            >
              {savingDetails ? 'Saving…' : 'Save'}
            </Button>
          </Box>
        </Box>
      </Paper>

      {/* ── Section 2: Add Members ── */}
      <Paper
        elevation={0}
        sx={{ p: { xs: 3, sm: 4 }, mb: 3, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}
      >
        <Box display="flex" alignItems="center" gap={2} mb={3}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2,
              bgcolor: 'success.50',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <PersonAddIcon sx={{ color: 'success.main', fontSize: 22 }} />
          </Box>
          <Box>
            <Typography variant="subtitle1" fontWeight="bold">
              Add Members
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Paste emails separated by spaces or newlines.
            </Typography>
          </Box>
        </Box>

        <Divider sx={{ mb: 3 }} />

        <Box display="flex" gap={2} alignItems="flex-start" flexWrap="wrap">
          <TextField
            fullWidth
            multiline
            rows={3}
            size="small"
            placeholder={'alice@example.com\nbob@example.com\ncarol@example.com'}
            value={newEmails}
            onChange={(e) => setNewEmails(e.target.value)}
            sx={{ flex: 1, minWidth: 240 }}
          />
          <Button
            variant="contained"
            color="success"
            onClick={handleAddMembers}
            disabled={!newEmails.trim() || addingMembers}
            startIcon={
              addingMembers ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <PersonAddIcon />
              )
            }
            sx={{ height: 40, flexShrink: 0 }}
          >
            {addingMembers ? 'Adding…' : 'Add Members'}
          </Button>
        </Box>
      </Paper>

      {/* ── Section 3: Current Members ── */}
      <Paper
        elevation={0}
        sx={{ mb: 3, border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden' }}
      >
        {/* Panel header */}
        <Box
          px={{ xs: 2, sm: 3 }}
          py={2}
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
          gap={2}
          sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}
        >
          <Box display="flex" alignItems="center" gap={1}>
            <PeopleAltIcon fontSize="small" color="action" />
            <Typography variant="subtitle1" fontWeight="bold">
              Current Members
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
              ({group?.member_count ?? 0})
            </Typography>
          </Box>
          <TextField
            size="small"
            placeholder="Search members…"
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" sx={{ color: 'text.disabled' }} />
                </InputAdornment>
              ),
            }}
            sx={{ width: { xs: '100%', sm: 220 } }}
          />
        </Box>

        {/* List */}
        {!group || group.members.length === 0 ? (
          <Box py={6} textAlign="center">
            <PeopleAltIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
            <Typography variant="body2" color="text.secondary">
              No members yet. Add emails above to get started.
            </Typography>
          </Box>
        ) : filteredMembers.length === 0 ? (
          <Box py={4} textAlign="center">
            <Typography variant="body2" color="text.secondary">
              No members match "<strong>{memberSearch}</strong>"
            </Typography>
          </Box>
        ) : (
          <List disablePadding sx={{ maxHeight: 440, overflow: 'auto' }}>
            {filteredMembers.map((member, index) => (
              <ListItem
                key={index}
                divider={index < filteredMembers.length - 1}
                sx={{ px: { xs: 2, sm: 3 }, py: 1.5 }}
              >
                <Avatar
                  sx={{
                    width: 34,
                    height: 34,
                    bgcolor: 'primary.50',
                    color: 'primary.main',
                    mr: 2,
                    fontSize: '0.8rem',
                    fontWeight: 'bold',
                    flexShrink: 0,
                  }}
                >
                  {member.email[0].toUpperCase()}
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

      {/* ── Section 4: Danger Zone — collapsible, anchored at bottom ── */}
      <Paper
        elevation={0}
        sx={{
          border: '1px solid',
          borderColor: 'error.light',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        {/* Collapsed toggle */}
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          px={{ xs: 2, sm: 3 }}
          py={2}
          onClick={() => setDangerOpen((v) => !v)}
          sx={{
            cursor: 'pointer',
            bgcolor: dangerOpen ? '#fff0f0' : 'transparent',
            transition: 'background 0.2s',
            '&:hover': { bgcolor: '#fff0f0' },
          }}
        >
          <Box display="flex" alignItems="center" gap={1.5}>
            <WarningAmberIcon color="error" fontSize="small" />
            <Typography variant="subtitle2" color="error" fontWeight="bold">
              Danger Zone
            </Typography>
          </Box>
          <ExpandMoreIcon
            color="error"
            sx={{
              fontSize: 20,
              transform: dangerOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          />
        </Box>

        <Collapse in={dangerOpen}>
          <Divider sx={{ borderColor: 'error.light' }} />
          <Box px={{ xs: 2, sm: 3 }} py={3}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              Permanently deleting this group will remove it from all associated Form Requests. This
              action <strong>cannot be undone</strong>.
            </Typography>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={handleDeleteGroup}
            >
              Delete Group
            </Button>
          </Box>
        </Collapse>
      </Paper>
    </Container>
  );
}