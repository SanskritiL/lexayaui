export const colors = {
  primary: '#d4838f',
  secondary: '#c77080',
  background: '#fff9f9',
  bgCard: '#fff5f5',
  text: '#6d4c5c',
  textLight: '#8b7082',
  border: '#f8d7da',
  success: '#7cb87c',
  warning: '#f59e0b',
  error: '#ef4444',
  white: '#ffffff',
  yakPink: '#f8d7da',
  yakCream: '#fff5f5',
  yakWarm: '#e8b4b8',
  yakDark: '#6d4c5c',
  yakAccent: '#d4838f',
};

export const card = {
  backgroundColor: colors.white,
  borderWidth: 2,
  borderColor: colors.border,
  borderRadius: 12,
  padding: 16,
  marginVertical: 6,
};

export const cardConnected = {
  ...card,
  borderColor: colors.success,
};

export const actionCard = {
  ...card,
  alignItems: 'center',
  paddingVertical: 20,
};

export const button = {
  paddingHorizontal: 24,
  paddingVertical: 12,
  borderRadius: 8,
  alignItems: 'center',
};

export const buttonPrimary = {
  ...button,
  backgroundColor: colors.primary,
};
