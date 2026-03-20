import { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  Button,
  Box,
  Alert,
  List,
  ListItem,
  ListItemText,
  Chip,
  IconButton,
  Tooltip,
  Container,
  Avatar,
  Skeleton,
  InputAdornment,
  TextField,
} from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditIcon from '@mui/icons-material/Edit';
import GroupIcon from '@mui/icons-material/Group';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import SearchIcon from '@mui/icons-material/Search';
import LinkIcon from '@mui/icons-material/Link';

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
  const [copySuccess, setCopySuccess] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');

  useEffect(() => {
    loadGroup();
  }, [groupId]);

  const loadGroup = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/groups/${groupId}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to load group');
      const data = await response.json();
      setGroup(data.group);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (!group) return;
    const inviteLink = `${window.location.origin}/groups/join/${group.invite_token}`;
    navigator.clipboard.writeText(inviteLink);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const filteredMembers = group?.members.filter((m) =>
    m.email.toLowerCase().includes(memberSearch.toLowerCase())
  ) ?? [];

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 3, mb: 3 }} />
        <Skeleton variant="rectangular" height={400} sx={{ borderRadius: 3 }} />
      </Container>
    );
  }

  if (error || !group) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error" sx={{ mb: 2 }}>{error || 'Group not found'}</Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/groups')}>Back to Groups</Button>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }} className="page-fade-in">
      {/* ── Back nav ── */}
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate('/groups')}
        sx={{ color: 'text.secondary', mb: 3 }}
      >
        Back to Groups
      </Button>

      {/* ── Hero Header Card ── */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 3, sm: 4 },
          mb: 3,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 3,
          background: 'linear-gradient(135deg, #f0f4ff 0%, #ffffff 60%)',
        }}
      >
        <Box
          display="flex"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          justifyContent="space-between"
          flexWrap="wrap"
          gap={2}
          mb={3}
        >
          {/* Left: Icon + Name + Description */}
          <Box display="flex" alignItems="center" gap={2}>
            <Box
              sx={{
                width: { xs: 48, sm: 60 },
                height: { xs: 48, sm: 60 },
                borderRadius: 2.5,
                bgcolor: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <GroupIcon sx={{ color: 'white', fontSize: { xs: 26, sm: 32 } }} />
            </Box>
            <Box>
              <Typography variant="h5" component="h1" fontWeight="bold" lineHeight={1.2}>
                {group.name}
              </Typography>
              <Typography variant="body2" color="text.secondary" mt={0.5}>
                {group.description || 'No description provided.'}
              </Typography>
            </Box>
          </Box>

          {/* Right: Edit Button */}
          <Button
            variant="contained"
            startIcon={<EditIcon />}
            onClick={() => navigate(`/groups/${groupId}/edit`)}
            sx={{ flexShrink: 0 }}
          >
            Edit Group
          </Button>
        </Box>

        {/* Stats + Invite Link Row */}
        <Box
          display="flex"
          flexWrap="wrap"
          gap={{ xs: 2, sm: 4 }}
          sx={{ pt: 3, borderTop: '1px solid', borderColor: 'divider' }}
        >
          <Box display="flex" alignItems="center" gap={1}>
            <PeopleAltIcon sx={{ fontSize: 18, color: 'primary.main' }} />
            <Typography variant="body2" fontWeight="medium">
              {group.member_count} member{group.member_count !== 1 ? 's' : ''}
            </Typography>
          </Box>
          <Box display="flex" alignItems="center" gap={1}>
            <CalendarTodayIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
            <Typography variant="body2" color="text.secondary">
              Created {new Date(group.created_at).toLocaleDateString()}
            </Typography>
          </Box>

          {/* Invite Link — right-aligned on desktop */}
          <Box display="flex" alignItems="center" gap={1} sx={{ ml: { xs: 0, sm: 'auto' } }}>
            <LinkIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
            <Typography
              variant="body2"
              sx={{
                fontFamily: 'monospace',
                color: 'text.secondary',
                maxWidth: { xs: 160, sm: 280 },
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: '0.75rem',
              }}
            >
              {`${window.location.origin}/groups/join/${group.invite_token}`}
            </Typography>
            <Tooltip title={copySuccess ? 'Copied!' : 'Copy invite link'}>
              <IconButton
                size="small"
                onClick={handleCopyLink}
                color={copySuccess ? 'success' : 'default'}
              >
                <ContentCopyIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Paper>

      {/* ── Members Panel ── */}
      <Paper
        elevation={0}
        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden' }}
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
          <Typography variant="subtitle1" fontWeight="bold">
            Recipients
          </Typography>
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
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
            <Chip
              label={`${filteredMembers.length} of ${group.members.length}`}
              size="small"
              color="primary"
              variant="outlined"
            />
          </Box>
        </Box>

        {/* Members list or empty states */}
        {group.members.length === 0 ? (
          <Box py={8} textAlign="center">
            <PeopleAltIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1.5 }} />
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              No members yet
            </Typography>
            <Typography variant="body2" color="text.disabled" sx={{ mb: 2.5 }}>
              Use <strong>Edit Group</strong> to add members manually or share the invite link.
            </Typography>
            <Button
              variant="outlined"
              startIcon={<EditIcon />}
              onClick={() => navigate(`/groups/${groupId}/edit`)}
              size="small"
            >
              Edit Group
            </Button>
          </Box>
        ) : filteredMembers.length === 0 ? (
          <Box py={6} textAlign="center">
            <Typography variant="body2" color="text.secondary">
              No members match "<strong>{memberSearch}</strong>"
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {filteredMembers.map((member, index) => (
              <ListItem
                key={index}
                divider={index < filteredMembers.length - 1}
                sx={{ px: { xs: 2, sm: 3 }, py: 1.5 }}
              >
                <Avatar
                  sx={{
                    width: 36,
                    height: 36,
                    bgcolor: 'primary.50',
                    color: 'primary.main',
                    mr: 2,
                    fontSize: '0.85rem',
                    fontWeight: 'bold',
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
                <Chip
                  label="Active"
                  size="small"
                  color="success"
                  variant="outlined"
                  sx={{ flexShrink: 0 }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    </Container>
  );
}