import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/card';
import { GithubSignInButton } from '#components/login/github-sign-in-button.tsx';

export function LoginForm() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Sign in to continue.</CardDescription>
      </CardHeader>
      <CardContent>
        <GithubSignInButton />
      </CardContent>
    </Card>
  );
}
