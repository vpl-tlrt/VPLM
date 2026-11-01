import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type AuthenticatedUser = {
  id: string;
  email: string;
  fullName: string;
  userPrincipalName: string;
  objectId: string;
  tenantId: string;
};

export const useUser = () => {
  return useQuery<AuthenticatedUser | null>({
    queryKey: ['authenticated-user'],
    queryFn: async () => {
      if (!supabase) return null;
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      const user = data.user;
      if (!user) return null;
      const email = user.email ?? '';
      const loginId = typeof user.user_metadata.login_id === 'string' ? user.user_metadata.login_id : email;
      return {
        id: user.id,
        email,
        fullName: user.user_metadata.full_name ?? email.split('@')[0] ?? 'Operator',
        userPrincipalName: loginId,
        objectId: user.id,
        tenantId: 'supabase-workspace',
      };
    },
    staleTime: 30_000,
    retry: false,
  });
};
