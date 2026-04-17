CREATE POLICY "Users can add organizer role to themselves"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id AND role = 'organizer'::app_role);