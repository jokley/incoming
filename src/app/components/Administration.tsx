import type { ReactNode } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { AdministrationTestData } from './AdministrationTestData';
import { DatabaseBackups } from './DatabaseBackups';

export function Administration() {
  return <Box sx={{ height: '100%', overflowY: 'auto', pb: 4 }}>
    <Box sx={{ mb: 3 }}>
      <Typography variant="overline" color="primary" fontWeight={700}>Administration</Typography>
      <Typography variant="h4" fontWeight={750}>Administration</Typography>
      <Typography color="text.secondary">Datenbank, Betriebsdaten und Wartung zentral verwalten.</Typography>
    </Box>
    <AdminSection title="Datenbank & Backups" description="PostgreSQL-Status, Sicherungen und Wiederherstellung."><DatabaseBackups embedded /></AdminSection>
    <AdminSection title="Datenverwaltung" description="Testdaten, Athleten, Zuweisungen und Workflows verwalten."><AdministrationTestData embedded /></AdminSection>
    <AdminSection title="Wartung" description="Zukünftige Wartungsfunktionen werden hier gebündelt."><Typography variant="body2" color="text.secondary">Derzeit sind keine zusätzlichen Wartungsaktionen erforderlich.</Typography></AdminSection>
  </Box>;
}

function AdminSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <Paper component="section" variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, mb: 2.5, borderRadius: 3 }}>
    <Typography variant="h5" fontWeight={700}>{title}</Typography>
    <Typography color="text.secondary" sx={{ mb: 2.5 }}>{description}</Typography>
    {children}
  </Paper>;
}
