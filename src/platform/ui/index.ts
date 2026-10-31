// ערכת הממשק המשותפת (shadcn, src/components/ui) לממשקי המנועים — re-export בלבד,
// בלי העתקה ובלי שינוי (Stage 2 plan §1.3). מתאם פלטפורמה ברשימה הסגורה של
// tests/architecture/boundaries.test.ts ו-eslint.config.js.
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
export { Badge } from "@/components/ui/badge";
export { Button, buttonVariants } from "@/components/ui/button";
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
export { Input } from "@/components/ui/input";
export { Label } from "@/components/ui/label";
export { Progress } from "@/components/ui/progress";
export { Separator } from "@/components/ui/separator";
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
export { Skeleton } from "@/components/ui/skeleton";
export { Toaster } from "@/components/ui/sonner";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
export { cn } from "@/lib/utils";
export { useIsMobile } from "@/hooks/use-mobile";
