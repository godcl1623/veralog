import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

export function AuthPage() {
  return (
    <main className={"flex size-full items-center justify-center"}>
      <Card className={"h-1/2 w-1/3 justify-center gap-10"}>
        <CardHeader>
          <CardTitle className={"text-center text-3xl font-bold"}>
            Veralog
          </CardTitle>
        </CardHeader>
        <CardContent className={"text-center"}>
          <Button variant={"outline"}>Login With Google</Button>
        </CardContent>
      </Card>
    </main>
  );
}
