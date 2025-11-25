using System.Collections.Specialized;
using System.Windows;
using System.Windows.Controls;
using LeagueMonitor.Core;
using LeagueMonitor.ViewModels;

namespace LeagueMonitor.Views;

/// <summary>
/// Interaction logic for MainWindow.xaml
/// </summary>
public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();

        // Auto-scroll log list when new items are added
        if (DataContext is MainViewModel vm)
        {
            ((INotifyCollectionChanged)vm.Logs).CollectionChanged += (s, e) =>
            {
                if (e.Action == NotifyCollectionChangedAction.Add && LogListBox.Items.Count > 0)
                {
                    LogListBox.ScrollIntoView(LogListBox.Items[LogListBox.Items.Count - 1]);
                }
            };
        }

        // Also subscribe to Logger's OnLog event for auto-scroll
        Logger.OnLog += (entry) =>
        {
            Dispatcher.BeginInvoke(() =>
            {
                if (LogListBox.Items.Count > 0)
                {
                    LogListBox.ScrollIntoView(LogListBox.Items[LogListBox.Items.Count - 1]);
                }
            });
        };
    }

    protected override async void OnClosing(System.ComponentModel.CancelEventArgs e)
    {
        // Dispose ViewModel to stop services
        if (DataContext is MainViewModel vm)
        {
            await vm.StopAsync();
            vm.Dispose();
        }

        base.OnClosing(e);
    }
}
