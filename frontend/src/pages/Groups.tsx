import { useState } from 'react';
import { useLoaderData, useNavigate } from 'react-router-dom';
import {
  Typography, Button, Box, CircularProgress, Alert, Card, CardContent,
  CardActionArea, IconButton, Tooltip, Divider, Container
} from '@mui/material';
import GroupIcon from '@mui/icons-material/Group';
import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditIcon from '@mui/icons-material/Edit';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';

import API_URL from '../config';
import AnimatedInfoButton from '../components/InfoButton';

interface Group {
  id: string;
  name: string;
  description: string;
  member_count: number;
  created_at: string;
}

export async function groupsLoader() {
  try {
    const response = await fetch(`${API_URL}/api/groups`, { credentials: 'include' });
    if (!response.ok) throw new Error('Failed to load groups');
    const data = await response.json();
    return { initialGroups: data.groups || [], loaderError: null };
  } catch (err: any) {
    return { initialGroups: [], loaderError: err.message };
  }
}

export default function Groups() {
  const navigate = useNavigate();
  const { initialGroups, loaderError } = useLoaderData() as { initialGroups: Group[]; loaderError: string | null };
  const [groups] = useState<Group[]>(initialGroups);
  const [error, setError] = useState<string | null>(loaderError);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const handleDuplicate = async (e: React.MouseEvent, groupId: string) => {
    e.stopPropagation();
    try {
      setDuplicatingId(groupId);
      const response = await fetch(`${API_URL}/api/groups/${groupId}/duplicate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to duplicate');
      const result = await response.json();
      navigate(`/groups/${result.group.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDuplicatingId(null);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }} className="page-fade-in">
      {/* Page Header */}
      <Box mb={4}>
        <Typography variant="h4" component="h1" fontWeight="bold" gutterBottom>
          Groups            <AnimatedInfoButton title="Groups Overview">
                              <p>Here is the groups page. You can view and manage recipient groups for your form requests here.</p>
                              <p>Click "Create New Group" to set up a new group, or click on an existing group to view its details and members.</p>
                            </AnimatedInfoButton>
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Manage recipient groups for your form requests.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Grid with ghost card first */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            lg: 'repeat(3, 1fr)',
            xl: 'repeat(4, 1fr)',
          },
          gap: 3,
        }}
      >
        {/* Ghost "Create" Card — always first */}
        <Card
          variant="outlined"
          sx={{
            borderRadius: 4,
            borderStyle: 'dashed',
            borderWidth: 2,
            borderColor: 'primary.main',
            bgcolor: 'transparent',
            transition: 'all 0.2s ease',
            minHeight: 180,
            '&:hover': {
              bgcolor: 'primary.50',
              borderColor: 'primary.dark',
              transform: 'translateY(-2px)',
              boxShadow: 3,
            },
          }}
        >
          <CardActionArea
            onClick={() => navigate('/groups/new')}
            sx={{
              height: '100%',
              minHeight: 180,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              p: 3,
            }}
          >
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                bgcolor: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mb: 1,
              }}
            >
              <AddIcon sx={{ color: 'white', fontSize: 28 }} />
            </Box>
            <Typography variant="subtitle1" fontWeight="bold" color="primary.main">
              Create New Group
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              Organize recipients for your form requests
            </Typography>
          </CardActionArea>
        </Card>

        {/* Group Cards */}
        {groups.map((group) => (
          <Card
            key={group.id}
            sx={{
              borderRadius: 4,
              display: 'flex',
              flexDirection: 'column',
              transition: 'all 0.2s ease',
              minHeight: 180,
              '&:hover': {
                transform: 'translateY(-2px)',
                boxShadow: 4,
              },
            }}
          >
            <CardActionArea
              onClick={() => navigate(`/groups/${group.id}`)}
              sx={{ flexGrow: 1, p: 0 }}
            >
              <CardContent sx={{ pb: 1 }}>
                {/* Card Header */}
                <Box display="flex" alignItems="flex-start" gap={1} mb={1.5}>
                  <Box
                    sx={{
                      width: 36,
                      height: 36,
                      borderRadius: 1.5,
                      bgcolor: 'primary.50',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      mt: 0.25,
                    }}
                  >
                    <GroupIcon sx={{ color: 'primary.main', fontSize: 20 }} />
                  </Box>
                  <Box minWidth={0}>
                    <Typography
                      variant="subtitle1"
                      fontWeight="bold"
                      noWrap
                      title={group.name}
                    >
                      {group.name}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        mt: 0.25,
                        minHeight: 40,
                      }}
                    >
                      {group.description || 'No description provided.'}
                    </Typography>
                  </Box>
                </Box>

                <Divider sx={{ my: 1.5 }} />

                {/* Meta Info */}
                <Box display="flex" alignItems="center" justifyContent="space-between">
                  <Box display="flex" alignItems="center" gap={0.75}>
                    <PeopleAltIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                    <Typography variant="body2" color="text.secondary">
                      {group.member_count} member{group.member_count !== 1 ? 's' : ''}
                    </Typography>
                  </Box>
                  <Box display="flex" alignItems="center" gap={0.75}>
                    <CalendarTodayIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography variant="caption" color="text.secondary">
                      {new Date(group.created_at).toLocaleDateString()}
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </CardActionArea>

            {/* Card Actions */}
            <Box
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              px={2}
              py={1}
              sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}
            >
              <Button
                size="small"
                startIcon={<EditIcon fontSize="small" />}
                onClick={(e) => { e.stopPropagation(); navigate(`/groups/${group.id}`); }}
                sx={{ fontSize: '0.75rem' }}
              >
                View Details
              </Button>
              <Tooltip title="Duplicate this group">
                <IconButton
                  size="small"
                  onClick={(e) => handleDuplicate(e, group.id)}
                  disabled={duplicatingId === group.id}
                  sx={{ color: 'grey.500' }}
                >
                  {duplicatingId === group.id ? (
                    <CircularProgress size={16} />
                  ) : (
                    <ContentCopyIcon sx={{ fontSize: 16 }} />
                  )}
                </IconButton>
              </Tooltip>
            </Box>
          </Card>
        ))}
      </Box>

      {groups.length === 0 && (
        <Box mt={2}>
          <Typography variant="body2" color="text.secondary" textAlign="center">
            No groups yet — create your first one using the card above.
          </Typography>
        </Box>
      )}
    </Container>
  );
}