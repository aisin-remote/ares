Imports SAP.Middleware.Connector
Imports System.Data
Imports System.Data.SqlClient
Imports System.Globalization

Public Class Form1
    Private _ccc As RfcDestination

    Dim log As String
    Dim con As New SqlConnection
    Dim cmd As New SqlCommand
    Dim reader As SqlDataReader
    Dim itab As New SqlDataAdapter
    Dim iset As New DataSet
    Dim idt As New DataTable

    Dim sqlquery As String

    Dim CHR_NUB_RPTNO_R3_KD As String
    Dim CHR_NUB_RPTNO_R3_KD_Y As String

    Dim PDS_NO As String
    Dim RECOVERY As String
    Dim PO_NO As String
    Dim MATERIALDOCUMENT As String
    Dim MATDOCUMENTYEAR As String
    Dim GOODSMVT_PSTNG_DATE As String = "yyyyMMdd"
    Dim dt As Date = Date.Today

    Private Sub Form1_Load(sender As Object, e As EventArgs) Handles MyBase.Load
        Try
            Me.Hide()
            Me.Visible = False
[connection string omitted]
            con.Open()
            cmd.Connection = con

            RfcDestinationManager.RegisterDestinationConfiguration(New ECCDestinationConfig)
            _ccc = RfcDestinationManager.GetDestination("PRD")
            Dim repository As RfcRepository = _ccc.Repository

            Dim rdscancel As IRfcFunction = _ccc.Repository.CreateFunction("ZZBAPI_GOODSMVT_CANCEL")

            sqlquery = "SELECT "
            sqlquery = sqlquery & "* "
            sqlquery = sqlquery & "FROM "
            sqlquery = sqlquery & "TT_PURCHASE_RECEIPT_H "
            sqlquery = sqlquery & "INNER JOIN "
            sqlquery = sqlquery & "TT_PURCHASE_RECEIPT_L "
            sqlquery = sqlquery & "ON "
            sqlquery = sqlquery & "TT_PURCHASE_RECEIPT_H.CHR_PDS_NO = TT_PURCHASE_RECEIPT_L.CHR_PDS_NO AND "
            sqlquery = sqlquery & "TT_PURCHASE_RECEIPT_H.CHR_PONO_R3 = TT_PURCHASE_RECEIPT_L.CHR_PONO_R3 "
            sqlquery = sqlquery & "WHERE "
            sqlquery = sqlquery & "((TT_PURCHASE_RECEIPT_H.CHR_RPTNO_R3_DEL = ' ' AND TT_PURCHASE_RECEIPT_H.CHR_RPTNO_R3_DEL_Y = ' ') OR (TT_PURCHASE_RECEIPT_H.CHR_RPTNO_R3_DEL is Null AND TT_PURCHASE_RECEIPT_H.CHR_RPTNO_R3_DEL_Y is Null)) AND "
            sqlquery = sqlquery & "TT_PURCHASE_RECEIPT_H.CHR_RPTNO_R3 <> ' ' AND TT_PURCHASE_RECEIPT_H.CHR_RPTNO_R3_Y <> ' ' AND "
            sqlquery = sqlquery & "TT_PURCHASE_RECEIPT_H.CHR_FLG_DEL = '1'  "
            sqlquery = sqlquery & "ORDER BY TT_PURCHASE_RECEIPT_H.CHR_PDS_NO "

            GOODSMVT_PSTNG_DATE = dt.ToString("yyyyMMdd")

            cmd = New SqlCommand(sqlquery, con)
            reader = cmd.ExecuteReader
            While reader.Read
                If Not reader.IsDBNull(0) Then

                    PDS_NO = reader("CHR_PDS_NO")
                    RECOVERY = reader("INT_PDS_PROCSEQ")
                    PO_NO = reader("CHR_PONO_R3")
                    MATERIALDOCUMENT = reader("CHR_RPTNO_R3")
                    MATDOCUMENTYEAR = reader("CHR_RPTNO_R3_Y")

                    rdscancel.SetValue("PDS_NO", PDS_NO)
                    rdscancel.SetValue("RECOVERY", RECOVERY)
                    rdscancel.SetValue("PO_NO", PO_NO)
                    rdscancel.SetValue("MATERIALDOCUMENT", MATERIALDOCUMENT)
                    rdscancel.SetValue("MATDOCUMENTYEAR", MATDOCUMENTYEAR)
                    rdscancel.SetValue("GOODSMVT_PSTNG_DATE", GOODSMVT_PSTNG_DATE)
                    rdscancel.Invoke(_ccc)
                End If
            End While
            Me.Close()
            Threading.Thread.Sleep(500)
        Catch ex As Exception
            MessageBox.Show(ex.Message.ToString())
            Me.Close()
        End Try
        Me.Close()
    End Sub
End Class