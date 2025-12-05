import { useState } from 'react';
import { Paper, Typography, Box, Button, Stack} from '@mui/material';
import { DataGrid, type GridColDef, type GridRenderCellParams } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';

// Interface matching the columns in your reference image
interface GroupRow {
  id: number;
  name: string;
  participants: number | null;
  created_at: string | null;
  last_request: string | null;
}

export default function Groups() {
  // Empty state to trigger the "No Rows" overlay
  const [rows] = useState<GroupRow[]>([]);

  // Column Definitions
  const columns: GridColDef[] = [
    { field: 'name', headerName: 'Group Name', flex: 1.5, minWidth: 200 },
    { 
      field: 'participants', 
      headerName: 'Participants', 
      width: 150, 
      align: 'center', 
      headerAlign: 'center',
      valueFormatter: (params: { value: any }) => params.value ?? '-' // Handle nulls gracefully
    },
    { 
      field: 'created_at', 
      headerName: 'Created', 
      width: 150, 
      valueFormatter: (params: { value: any }) => params.value ?? '-' 
    },
    { 
      field: 'last_request', 
      headerName: 'Last Request', 
      width: 150, 
      valueFormatter: (params: { value: any }) => params.value ?? '-' 
    },
    { 
      field: 'details', 
      headerName: '', 
      width: 120,
      sortable: false,
      renderCell: (params: GridRenderCellParams) => (
        <Button variant="outlined" size="small" onClick={() => console.log('View details', params.id)}>
          Details
        </Button>
      )
    },
  ];

  // Custom "No Data" Message
  const CustomNoRowsOverlay = () => (
    <Stack height="100%" alignItems="center" justifyContent="center">
      <Typography color="text.secondary">
        You don't have any groups, which is good, since we didn't implement them yet!
      </Typography>
    </Stack>
  );

  return (
    <Box>
      {/* Header Section with "Create" button */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">
            Your Groups
        </Typography>
        <Button 
            variant="contained" 
            startIcon={<AddIcon />}
            onClick={() => console.log("Navigate to create group")}
        >
            Create New Group
        </Button>
      </Box>

      {/* Data Grid Table */}
      <Paper sx={{ height: 500, width: '100%', p: 1 }}>
        <DataGrid
            rows={rows}
            columns={columns}
            slots={{ noRowsOverlay: CustomNoRowsOverlay }}
            initialState={{
                pagination: { paginationModel: { pageSize: 10 } },
            }}
            pageSizeOptions={[5, 10, 25]}
            disableRowSelectionOnClick
        />
      </Paper>
    </Box>
  );
}