import { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  Button,
  Box,
  CircularProgress,
  Alert,
  List,
  ListItem,
  ListItemText,
  Chip,
  IconButton,
  Divider,
  Stack,
  Tooltip,
  Container,
  Grid,
  Avatar,
  Skeleton,
} from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditIcon from '@mui/icons-material/Edit';
import GroupIcon from '@mui/icons-material/Group';
import PersonIcon from '@mui/icons-material/Person';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
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

export default function ViewGroup() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();

  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

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

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Skeleton variant="rectangular" height={40} sx={{ mb: 3, borderRadius: 1 }} />
        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <Skeleton variant="rectangular" height={260} sx={{ borderRadius: 2 }} />
          </Grid>
          <Grid item xs={12} md={8}>
            <Skeleton variant="rectangular" height={400} sx={{ borderRadius: 2 }} />
          </Grid>
        </Grid>
      </Container>
    );
  }

  if (error || !group) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error" sx={{ mb: 2 }}>{error || 'Group not found'}</Alert>
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
          onClick={() => navigate('/groups')}
          color="inherit"
          sx={{ color: 'text.secondary' }}
        >
          Back to Groups
        </Button>
        <Button
          variant="contained"
          startIcon={<EditIcon />}
          onClick={() => navigate(`/groups/${groupId}/edit`)}
        >
          Edit Group
        </Button>
      </Box>

      <Grid container spacing={3}>
        {/* ── Left Column ── */}
        <Grid item xs={12} md={4}>
          <Stack spacing={3}>
            {/* Group Info Card */}
            <Paper sx={{ p: 3 }}>
              <Box display="flex" alignItems="center" gap={1.5} mb={2}>
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
                <Typography variant="h6" fontWeight="bold">
                  {group.name}
                </Typography>
              </Box>

              <Typography variant="body2" color="text.secondary" paragraph>
                {group.description || 'No description provided.'}
              </Typography>

              <Divider sx={{ my: 2 }} />

              <Stack spacing={1.5}>
                <Box display="flex" alignItems="center" gap={1} color="text.secondary">
                  <CalendarTodayIcon fontSize="small" />
                  <Typography variant="body2">
                    Created {new Date(group.created_at).toLocaleDateString()}
                  </Typography>
                </Box>
                <Box display="flex" alignItems="center" gap={1} color="text.secondary">
                  <PeopleAltIcon fontSize="small" />
                  <Typography variant="body2">
                    {group.member_count} active member{group.member_count !== 1 ? 's' : ''}
                  </Typography>
                </Box>
              </Stack>
            </Paper>

            {/* Invite Link Card */}
            <Paper sx={{ p: 3 }}>
              <Typography
                variant="overline"
                color="primary.main"
                fontWeight="bold"
                display="block"
                gutterBottom
              >
                Invite Link
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Share this link to allow people to join this group automatically.
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  bgcolor: 'grey.50',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  px: 1.5,
                  py: 1,
                  gap: 1,
                }}
              >
                <Typography
                  variant="body2"
                  noWrap
                  sx={{ flex: 1, fontFamily: 'monospace', color: 'text.secondary', fontSize: '0.75rem' }}
                >
                  {`${window.location.origin}/groups/join/${group.invite_token}`}
                </Typography>
                <Tooltip title={copySuccess ? 'Copied!' : 'Copy link'}>
                  <IconButton size="small" onClick={handleCopyLink} color={copySuccess ? 'success' : 'primary'}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Paper>
          </Stack>
        </Grid>

        {/* ── Right Column: Members List ── */}
        <Grid item xs={12} md={8}>
          <Paper sx={{ overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Panel Header */}
            <Box
              px={3}
              py={2}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}
            >
              <Typography variant="subtitle1" fontWeight="bold">
                Recipients List
              </Typography>
              <Chip
                label={`${group.members.length} Total`}
                size="small"
                color="primary"
                variant="outlined"
              />
            </Box>

            {/* Members */}
            {group.members.length === 0 ? (
              <Box p={4} textAlign="center" flexGrow={1} display="flex" flexDirection="column" justifyContent="center" alignItems="center" gap={1}>
                <PeopleAltIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
                <Typography variant="subtitle2" color="text.secondary">
                  No members yet
                </Typography>
                <Typography variant="body2" color="text.disabled">
                  Use the <strong>Edit Group</strong> button to add members.
                </Typography>
              </Box>
            ) : (
              <List sx={{ overflow: 'auto', maxHeight: 540, p: 0 }}>
                {group.members.map((member, index) => (
                  <ListItem
                    key={index}
                    divider={index < group.members.length - 1}
                    sx={{ px: 3, py: 1.5 }}
                  >
                    <Avatar
                      sx={{
                        width: 36,
                        height: 36,
                        bgcolor: 'grey.100',
                        color: 'text.secondary',
                        mr: 2,
                        flexShrink: 0,
                      }}
                    >
                      <PersonIcon fontSize="small" />
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
                      sx={{ ml: 2, flexShrink: 0 }}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
}