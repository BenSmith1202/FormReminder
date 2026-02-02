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
  Grid
} from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditIcon from '@mui/icons-material/Edit';
import GroupIcon from '@mui/icons-material/Group';
import PersonIcon from '@mui/icons-material/Person';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';

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
  const [deleting, setDeleting] = useState(false);

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
    alert('Invite link copied to clipboard!');
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
      <Box p={3}>
        <Alert severity="error" sx={{ mb: 2 }}>{error || 'Group not found'}</Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/groups')}>
          Back to Groups
        </Button>
      </Box>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Header Navigation */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/groups')} sx={{ color: 'text.secondary' }}>
          Back to Groups
        </Button>
        <Box display="flex" gap={2}>
            <Button 
                variant="contained" 
                startIcon={<EditIcon />} 
                onClick={() => navigate(`/groups/${groupId}/edit`)}
            >
                Edit Group
            </Button>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Left Column: Group Info & Stats */}
        <Grid item xs={12} md={4}>
            <Stack spacing={3}>
                <Paper sx={{ p: 3 }}>
                    <Box display="flex" alignItems="center" mb={2} color="primary.main">
                        <GroupIcon sx={{ fontSize: 40, mr: 2 }} />
                        <Typography variant="h5" fontWeight="bold" color="text.primary">
                            {group.name}
                        </Typography>
                    </Box>
                    
                    <Typography variant="body1" color="text.secondary" paragraph>
                        {group.description || 'No description provided.'}
                    </Typography>

                    <Divider sx={{ my: 2 }} />
                    
                    <Stack spacing={1}>
                      <Box display="flex" alignItems="center" gap={1} color="text.secondary">
                          <CalendarTodayIcon fontSize="small" />
                          <Typography variant="body2">
                              Created: {new Date(group.created_at).toLocaleDateString()}
                          </Typography>
                      </Box>
                      <Box display="flex" alignItems="center" gap={1} color="text.secondary">
                          <PersonIcon fontSize="small" />
                          <Typography variant="body2">
                              {group.member_count} active members
                          </Typography>
                      </Box>
                    </Stack>
                </Paper>

                <Paper sx={{ p: 3, bgcolor: 'primary.50' }}>
                    <Typography variant="subtitle2" color="primary.main" gutterBottom fontWeight="bold">
                        INVITE LINK
                    </Typography>
                    <Typography variant="body2" color="text.secondary" paragraph>
                        Share this link to allow people to join this group automatically.
                    </Typography>
                    
                    <Box 
                        sx={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            bgcolor: 'background.paper', 
                            p: 1, 
                            borderRadius: 1,
                            border: '1px solid',
                            borderColor: 'divider'
                        }}
                    >
                        <Typography 
                            variant="body2" 
                            noWrap 
                            sx={{ flex: 1, fontFamily: 'monospace', color: 'text.secondary', mr: 1 }}
                        >
                            {`${window.location.origin}/groups/join/${group.invite_token}`}
                        </Typography>
                        <Tooltip title="Copy Link">
                            <IconButton size="small" onClick={handleCopyLink} color="primary">
                                <ContentCopyIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Box>
                </Paper>
            </Stack>
        </Grid>

        {/* Right Column: Immutable Members List */}
        <Grid item xs={12} md={8}>
            <Paper sx={{ p: 0, overflow: 'hidden', height: '100%' }}>
                <Box p={3} borderBottom={1} borderColor="divider" display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="h6">
                        Recipients List
                    </Typography>
                    <Chip label={`${group.members.length} Total`} size="small" />
                </Box>

                {group.members.length === 0 ? (
                    <Box p={4} textAlign="center">
                        <Typography color="text.secondary">
                            No members found. Use the <strong>Edit Group</strong> button to add members.
                        </Typography>
                    </Box>
                ) : (
                    <List sx={{ overflow: 'auto', maxHeight: '600px' }}>
                        {group.members.map((member, index) => (
                            <ListItem key={index} divider={index < group.members.length - 1}>
                                <Box sx={{ mr: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: '50%', bgcolor: 'grey.100' }}>
                                    <PersonIcon color="action" />
                                </Box>
                                <ListItemText
                                    primary={
                                        <Typography variant="subtitle1" fontWeight="medium">
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
                                    sx={{ ml: 2 }}
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