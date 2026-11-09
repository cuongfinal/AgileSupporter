import {
  ArrowDown,
  ArrowUp,
  Calculator,
  ChartLine,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileChartColumn,
  GripVertical,
  Info,
  Lightbulb,
  ListTodo,
  Monitor,
  Moon,
  type LucideIcon,
  type LucideProps,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SquareCheck,
  Sun,
  Timer,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

// App icon set (lucide). Names describe the meaning, so a later icon swap stays in this file.
const make = (Icon: LucideIcon) => {
  const C = (p: LucideProps) => <Icon size={16} strokeWidth={2} aria-hidden {...p} />;
  C.displayName = Icon.displayName;
  return C;
};

export const RefreshIcon = make(RefreshCw);
export const DownloadIcon = make(Download);
export const ExternalIcon = make(ExternalLink);
export const AddIcon = make(Plus);
export const ArrowDownIcon = make(ArrowDown);
export const ArrowUpIcon = make(ArrowUp);
export const TrashIcon = make(Trash2);
export const CheckCircleIcon = make(CircleCheck);
export const InfoIcon = make(Info);
export const IdeaIcon = make(Lightbulb);
export const TaskIcon = make(SquareCheck);
export const CalculatorIcon = make(Calculator);
export const ChartIcon = make(ChartLine);
export const ReportIcon = make(FileChartColumn);
export const SettingsIcon = make(Settings);
export const ListIcon = make(ListTodo);
export const ClockIcon = make(Clock);
export const CopyIcon = make(Copy);
export const CheckIcon = make(Check);
export const EditIcon = make(Pencil);
export const SearchIcon = make(Search);
export const UploadIcon = make(CloudUpload);
export const DragIcon = make(GripVertical);
export const EyeIcon = make(Eye);
export const ChevronDownIcon = make(ChevronDown);
export const ChevronRightIcon = make(ChevronRight);
export const CloseIcon = make(X);
export const TimerIcon = make(Timer);
export const WarningIcon = make(TriangleAlert);
export const SystemThemeIcon = make(Monitor);
export const LightThemeIcon = make(Sun);
export const DarkThemeIcon = make(Moon);
