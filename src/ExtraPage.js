
export  function ExtraPage() {
  return (
    <div className="min-h-screen bg-slate-100 py-10 px-4 sm:px-6 lg:px-12">
      <div className="max-w-5xl mx-auto bg-white rounded-2xl shadow-md p-6">
        <h1 className="text-2xl font-bold mb-4 text-slate-800">
          Other Information Page
        </h1>
        <p className="text-slate-600 mb-2">
          This is an extra page just to demonstrate route protection and header
          navigation.
        </p>
        <p className="text-slate-600">
          You can put any content here – reports, help text, documentation, or
          internal notes for your CRM users.
        </p>
      </div>
    </div>
  );
}
