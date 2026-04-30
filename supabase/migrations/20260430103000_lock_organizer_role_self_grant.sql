DROP POLICY IF EXISTS "Users can add organizer role to themselves" ON public.user_roles;

CREATE POLICY "Admins can assign organizer roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
