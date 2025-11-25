using System.Windows;
using LeagueMonitor.Core;

namespace LeagueMonitor;

/// <summary>
/// Interaction logic for App.xaml
/// </summary>
public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        
        // Initialize logger with dispatcher
        Logger.Initialize(Dispatcher);

        // Enable privileges for process management
        PrivilegeManager.EnableAllPrivileges();
    }
}
