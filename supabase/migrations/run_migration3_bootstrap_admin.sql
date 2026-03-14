UPDATE learners SET platform_role = 'ssi_admin' WHERE user_id = (SELECT id::text FROM auth.users WHERE email = 'thomas.cassidy+ssi@gmail.com');
