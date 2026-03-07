import { useState, useEffect } from 'react';
import { Paper, Typography, Button, Box, CircularProgress, Alert, Card, CardContent, CardActions, IconButton, Tooltip } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import GroupIcon from '@mui/icons-material/Group';
import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

const API_URL = 'http://localhost:5000';

interface Group {
  id: string;
  name: string;
  description: string;
  member_count: number;
  created_at: string;
}

export default function Groups() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  useEffect(() => {
    loadGroups();
  }, []);

  const loadGroups = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/groups`, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to load groups');
      }
      
      const data = await response.json();
      console.log('Loaded groups:', data);
      setGroups(data.groups || []);
    } catch (err: any) {
      console.error('Error loading groups:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Duplicate a group and navigate to the new one
  const handleDuplicate = async (groupId: string) => {
    try {
      setDuplicatingId(groupId);
      const response = await fetch(`${API_URL}/api/groups/${groupId}/duplicate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to duplicate');
      
      const result = await response.json();
      // Navigate to the new duplicated group
      navigate(`/groups/${result.group.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDuplicatingId(null);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">
          Groups
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate('/groups/new')}
        >
          Create New Group
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {groups.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <GroupIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            No groups yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Create a group to organize recipients for your form requests
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/groups/new')}
          >
            Create Your First Group
          </Button>
        </Paper>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              md: 'repeat(2, 1fr)',
              lg: 'repeat(3, 1fr)'
            },
            gap: 3
          }}
        >
          {groups.map((group) => (
            <Card key={group.id}>
              <CardContent>
                <Box display="flex" alignItems="center" mb={1}>
                  <GroupIcon sx={{ mr: 1, color: 'primary.main' }} />
                  <Typography variant="h6">
                    {group.name}
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, minHeight: 40 }}>
                  {group.description || 'No description'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {group.member_count} member{group.member_count !== 1 ? 's' : ''}
                </Typography>
              </CardContent>
              <CardActions>
                <Button size="small" onClick={() => navigate(`/groups/${group.id}`)}>
                  View Details
                </Button>
                <Tooltip title="Duplicate this group">
                  <IconButton
                    size="small"
                    onClick={() => handleDuplicate(group.id)}
                    disabled={duplicatingId === group.id}
                    sx={{ color: 'grey.600', ml: 'auto' }}
                  >
                    {duplicatingId === group.id ? (
                      <CircularProgress size={20} />
                    ) : (
                      <ContentCopyIcon fontSize="small" />
                    )}
                  </IconButton>
                </Tooltip>
              </CardActions>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}
