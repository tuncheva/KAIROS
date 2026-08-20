export default function ChatLoading() {
  return (
    <div className="h-[100dvh] overflow-hidden bg-bg-primary">
      <div className="lg:ml-16 h-[100dvh] overflow-hidden flex flex-col">
        <div className="flex-1 flex flex-col p-4 gap-4">
          <div className="h-8 w-48 bg-bg-secondary rounded animate-pulse" />
          <div className="flex-1 space-y-4">
            <div className="h-12 w-3/4 bg-bg-secondary rounded-lg animate-pulse" />
            <div className="h-12 w-1/2 bg-bg-secondary rounded-lg animate-pulse ml-auto" />
            <div className="h-12 w-2/3 bg-bg-secondary rounded-lg animate-pulse" />
          </div>
          <div className="h-12 bg-bg-secondary rounded-xl animate-pulse" />
        </div>
      </div>
    </div>
  );
}
